import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import ort from 'onnxruntime-node';
import { SPEECH_END, SpeechEnd, Vad } from '../../src/lib/vad.ts';
import { CHUNK, SAMPLE_RATE, WakeWordDetector, type Run } from '../../src/lib/wakeword.ts';
import { toWav } from '../../src/lib/wakeword-recorder.ts';
import { Resampler } from './resample.ts';
import { duck, filler, sendOrder, serverName, serverReady, speech } from './server.ts';
import { beep, hush, play, speakerName } from './sound.ts';
import { Timers } from './timers.ts';
import type { VoiceAction } from '../../src/lib/voice.ts';

/**
 * The voice satellite (#223, phase 1): «hola casita» heard on a Raspberry in the living room, out of
 * the browser, with the same code as the phone's (wakeword.ts, vad.ts) and ONNX Runtime for Node.
 * The microphone comes from `arecord` at its own rate, taken to 16 kHz mono here (resample.ts). For now each order only goes to the log and is
 * kept as a WAV (`ORDERS_DIR`), to hear what it cut; and, with `SERVER_URL` and `SATELLITE_KEY`, sent
 * to the house's server (server.ts), its answer to the log and, with `SPEAKER`, aloud (sound.ts).
 */

const MODELS_DIR = process.env.MODELS_DIR ?? '/satellite/models';
/** The ALSA device, e.g. `plughw:CARD=Microphone` (`arecord -L` lists them). */
const MIC = process.env.MIC ?? 'default';
/** What the microphone itself gives (/proc/asound/cardN/stream0): ALSA then converts nothing. */
const MIC_RATE = Number(process.env.MIC_RATE ?? 48_000);
const MIC_CHANNELS = Number(process.env.MIC_CHANNELS ?? 2);
/**
 * As the phone's slider (wake-word.svelte.ts, `WAKE_THRESHOLD`), lower: with a video 2–3 m away
 * (2026-10-26) nothing came to 0.25 by itself, and «hola casita» said in other ways gave 0.21–0.36.
 */
const THRESHOLD = Number(process.env.WAKE_THRESHOLD ?? 0.3);
/** As the phone's «Margen» (vad.ts, `marginDb`). */
const MARGIN_DB = Number(process.env.WAKE_MARGIN_DB ?? SPEECH_END.marginDb);
const ORDERS_DIR = process.env.ORDERS_DIR ?? '/data/ordenes';
/** The last orders kept as WAV; older ones deleted. */
const KEEP_ORDERS = 20;
const MODEL = 'hola_casita';
/** As the phone's: the word's level is the loudest of this long before it went off. */
const WORD_MS = 1500;
/** After an order, this long before the word is heard again. */
const QUIET_MS = 1500;
/** The AI taking longer than this to answer, a phrase meanwhile («Vale», Ajustes → Casa). */
const FILLER_AFTER_MS = 1500;
/** The timers, kept in its volume as the orders. */
const TIMERS_FILE = process.env.TIMERS_FILE ?? '/data/temporizadores.json';
/** As the phone's: more than this ringing, it stops sounding (no one is there). */
const RING_MAX_MS = 3 * 60_000;
/** Between each «din-don» and its words: quiet enough for «hola casita» to be heard and stop it. */
const RING_PAUSE_MS = 5000;
/** As holding the button: longer than this, it is over anyway. */
const MAX_MS = 30_000;

type Session = Awaited<ReturnType<typeof ort.InferenceSession.create>>;

const log = (text: string) => console.log(`${new Date().toLocaleTimeString('es-ES')} ${text}`);
const db = (value: number | null) => (value === null ? '—' : `${value.toFixed(0)} dB`);

/**
 * One thread each, as in the browser: the models are small, and ONNX Runtime's pool of a thread per
 * core kept them spinning, near three of the Pi's four cores with nothing said.
 */
async function load(file: string): Promise<Session> {
	return ort.InferenceSession.create(`${MODELS_DIR}/${file}.onnx`, {
		intraOpNumThreads: 1,
		interOpNumThreads: 1,
		executionMode: 'sequential'
	});
}

const [melspectrogram, embedding, word, silero] = await Promise.all([
	load('melspectrogram'),
	load('embedding_model'),
	load(MODEL),
	load('silero_vad')
]);
const sessions = new Map<string, Session>([
	['melspectrogram', melspectrogram],
	['embedding', embedding],
	[MODEL, word]
]);

const run: Run = async (name, input, dims) => {
	const session = sessions.get(name)!;
	const out = await session.run({
		[session.inputNames[0]!]: new ort.Tensor('float32', input, dims)
	});
	return out[session.outputNames[0]!]!.data as Float32Array;
};

const frames = Number(
	(word.inputMetadata[0] as { shape?: number[] } | undefined)?.shape?.[1] ?? 16
);
const detector = new WakeWordDetector(run, [{ name: MODEL, frames }]);
await detector.warmUp();

const sampleRate = new ort.Tensor('int64', BigInt64Array.from([BigInt(SAMPLE_RATE)]), []);
/** A fresh Silero VAD for each order, as the phone's `vad()`. */
function vad() {
	return new Vad(async (input, state) => {
		const out = await silero.run({
			input: new ort.Tensor('float32', input, [1, input.length]),
			state: new ort.Tensor('float32', state, [2, 1, 128]),
			sr: sampleRate
		});
		return {
			probability: (out.output!.data as Float32Array)[0] ?? 0,
			state: out.stateN!.data as Float32Array
		};
	});
}

interface Order {
	vad: Vad;
	end: SpeechEnd;
	chunks: Int16Array[];
	startedAt: number;
}

let order: Order | null = null;
/** An order on its way to the server: no other until it answers. */
let busy = false;
let quietUntil = 0;
/** The highest score of an attempt (over half the threshold), logged once it falls. */
let attempt = 0;
/** The microphone's last levels, for the word's (`WORD_MS`). */
const recent: { at: number; dbfs: number }[] = [];

async function step(chunk: Float32Array) {
	const now = Date.now();
	let sum = 0;
	for (let i = 0; i < chunk.length; i++) sum += (chunk[i]! / 32768) ** 2;
	recent.push({ at: now, dbfs: 10 * Math.log10(sum / chunk.length || 1e-9) });
	while (recent[0]!.at < now - WORD_MS) recent.shift();

	// Always through the detector, as in the browser: its buffers stay continuous.
	const scores = await detector.push(chunk);
	if (order) return listen(order, chunk, now);
	for (const [score = 0] of scores) {
		if (score >= THRESHOLD / 2) attempt = Math.max(attempt, score);
		else if (attempt) {
			log(`Palabra: ${attempt.toFixed(2)} · ${attempt >= THRESHOLD ? 'saltó' : 'no llegó'}`);
			attempt = 0;
		}
		if (score >= THRESHOLD && now >= quietUntil && !order && !busy) begin(score);
	}
}

function begin(score: number) {
	// As touching the phone: what rings stops, and the order may be about it («quítalo»).
	if (timers.ringing.length) {
		log(`Parado: ${timers.ringing.map((t) => t.label).join(', ')}`);
		timers.silence();
		hush();
	}
	const voiceDb = Math.max(...recent.map((r) => r.dbfs));
	// Its attempt ends here: what it reached, with the order and not after it.
	attempt = 0;
	log(`«Hola casita» (${score.toFixed(2)}): escuchando (la palabra a ${db(voiceDb)})`);
	duck(true);
	void beep(880);
	order = {
		vad: vad(),
		end: new SpeechEnd({ ...SPEECH_END, marginDb: MARGIN_DB }, voiceDb),
		chunks: [],
		startedAt: Date.now()
	};
}

async function listen(current: Order, chunk: Float32Array, now: number) {
	current.chunks.push(Int16Array.from(chunk));
	for (const { probability, dbfs } of await current.vad.push(chunk)) {
		const said = current.end.frame(probability, dbfs);
		if (said !== 'listening') return finish(current, said);
	}
	if (now - current.startedAt >= MAX_MS) return finish(current, 'done');
}

async function finish(current: Order, said: 'done' | 'nothing') {
	order = null;
	quietUntil = Date.now() + QUIET_MS;
	const { voiceDb, backgroundDb, backgroundMs, capped } = current.end.report;
	const seconds = (current.chunks.length * CHUNK) / SAMPLE_RATE;
	if (said === 'nothing') {
		duck(false);
		void beep(440);
		return log(`Nada dicho en ${seconds.toFixed(1)} s`);
	}
	const background =
		backgroundDb === null
			? 'nada de fondo'
			: `de fondo ${db(backgroundDb)} (${(backgroundMs / 1000).toFixed(1)} s sin contar)`;
	const how = capped ? 'por tiempo' : 'por silencio';
	log(`Orden de ${seconds.toFixed(1)} s, ${how}: tu voz ${db(voiceDb)}, ${background}`);
	const samples = new Int16Array(current.chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of current.chunks) {
		samples.set(c, at);
		at += c.length;
	}
	const wav = toWav(samples);
	void beep(660);
	await keep(wav);
	// Not waited for here: the microphone goes on through the detector meanwhile.
	if (serverReady) void respond(wav);
	else duck(false);
}

/**
 * To the server, and its answer to the log and aloud; not heard meanwhile, it is busy. If the AI
 * takes long, a phrase meanwhile («Vale»), and the answer after it.
 */
async function respond(wav: Uint8Array) {
	busy = true;
	const started = Date.now();
	let waiting: ReturnType<typeof setTimeout> | undefined;
	let saidFiller: Promise<void> = Promise.resolve();
	try {
		const done = await sendOrder(
			wav,
			() => timers.describe(),
			() => {
				waiting = setTimeout(() => (saidFiller = sayFiller()), FILLER_AFTER_MS);
			}
		);
		clearTimeout(waiting);
		const ms = Date.now() - started;
		if (!done) {
			log(`No se entendió nada (${ms} ms)`);
			await beep(440);
		} else {
			const actions = done.reply.actions.map((a) => a.kind).join(', ') || 'ninguna';
			log(`«${done.text}» → «${done.reply.reply}» (acciones: ${actions}; ${ms} ms)`);
			for (const action of done.reply.actions) act(action);
			// Asked even without a speaker: the server may say it through Snapcast.
			if (done.reply.reply) {
				const voice = await speech(done.reply.reply);
				if (!voice) log(`Dicho por Snapcast (${Date.now() - started} ms desde la orden)`);
				else if (speakerName) {
					// Read while the phrase sounded; said after it.
					await saidFiller;
					log(`Dicho en voz (${Date.now() - started} ms desde la orden)`);
					await play(voice);
				}
			}
		}
	} catch (err) {
		log(`El servidor no respondió: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		clearTimeout(waiting);
		busy = false;
		quietUntil = Date.now() + QUIET_MS;
		duck(false);
	}
}

/** A phrase while the AI thinks: on its speaker, or through Snapcast by the server. Never fails. */
async function sayFiller() {
	try {
		log('La IA tarda: frase de espera');
		const voice = await filler();
		if (voice && speakerName) await play(voice);
	} catch (err) {
		log(`Sin frase de espera: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** What the AI asked that is the satellite's to do: its timers. The rest are the phone's. */
function act(action: VoiceAction) {
	switch (action.kind) {
		case 'timer': {
			const label = timers.start(action.label, action.seconds);
			return log(`Temporizador «${label}»: ${action.seconds} s`);
		}
		case 'prepareTimer': {
			const label = timers.prepare(action.label, action.seconds, action.trigger);
			return log(`Temporizador «${label}» preparado: cuando ${action.trigger}`);
		}
		case 'cancelTimer':
			log(`Quitados: ${timers.cancel(action.label)}`);
			if (!timers.ringing.length) hush();
			return;
	}
}

const timers = new Timers((saved) => {
	writeFile(TIMERS_FILE, JSON.stringify(saved)).catch((err) =>
		console.error('No se pudieron guardar los temporizadores', err)
	);
});
try {
	timers.load(JSON.parse(await readFile(TIMERS_FILE, 'utf8')));
} catch {
	// None yet.
}
let ringing = false;
// Those that ended while it was off ring at once, as the phone's.
setInterval(() => {
	if (timers.due().length) void ring();
}, 1000);

/**
 * What ended rings: a «din-don» and its name said (as the AI wrote it), again and again with a pause,
 * until «hola casita» stops it or for `RING_MAX_MS`. Where it answers: its speaker, or Snapcast.
 * Never over an order being heard or answered.
 */
async function ring() {
	if (ringing) return;
	ringing = true;
	const started = Date.now();
	try {
		while (timers.ringing.length && Date.now() - started < RING_MAX_MS) {
			if (!order && !busy) {
				const text = `Aviso: ${timers.ringing.map((t) => t.label).join(' y ')}.`;
				log(`Sonando: ${text}`);
				try {
					const voice = await speech(text, { chime: true });
					if (voice && timers.ringing.length) await play(voice);
				} catch (err) {
					// The server not answering: at least its own «din-don».
					log(`Sin voz para el aviso: ${err instanceof Error ? err.message : String(err)}`);
					await beep(880);
					await beep(660);
				}
			}
			await sleep(RING_PAUSE_MS);
		}
	} finally {
		ringing = false;
	}
}

/** The order as a WAV, to hear what was cut; the oldest past `KEEP_ORDERS` deleted. */
async function keep(wav: Uint8Array) {
	try {
		await mkdir(ORDERS_DIR, { recursive: true });
		const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
		await writeFile(`${ORDERS_DIR}/${name}`, wav);
		const files = (await readdir(ORDERS_DIR)).filter((f) => f.endsWith('.wav')).sort();
		for (const old of files.slice(0, -KEEP_ORDERS)) await rm(`${ORDERS_DIR}/${old}`);
		log(`Guardada en ${ORDERS_DIR}/${name}`);
	} catch (err) {
		console.error('No se pudo guardar la orden', err);
	}
}

const mic = spawn(
	'arecord',
	['-D', MIC, '-f', 'S16_LE', '-r', `${MIC_RATE}`, '-c', `${MIC_CHANNELS}`, '-t', 'raw', '-q'],
	{ stdio: ['ignore', 'pipe', 'inherit'] }
);
const resampler = new Resampler(MIC_RATE);
const frameBytes = MIC_CHANNELS * 2;
// One chunk at a time: if one takes longer than 80 ms, the next waits its turn.
let queue = Promise.resolve();
let bytes = Buffer.alloc(0);
let samples: number[] = [];
mic.stdout.on('data', (data: Buffer) => {
	bytes = Buffer.concat([bytes, data]);
	const whole = Math.floor(bytes.length / frameBytes);
	// The channels mixed to one.
	const mono = new Float32Array(whole);
	for (let f = 0; f < whole; f++) {
		let sum = 0;
		for (let c = 0; c < MIC_CHANNELS; c++) sum += bytes.readInt16LE(f * frameBytes + c * 2);
		mono[f] = sum / MIC_CHANNELS;
	}
	bytes = bytes.subarray(whole * frameBytes);
	samples = samples.concat(resampler.push(mono));
	while (samples.length >= CHUNK) {
		const chunk = Float32Array.from(samples.splice(0, CHUNK));
		queue = queue.then(() => step(chunk)).catch((err) => console.error(err));
	}
});
mic.on('exit', (code) => {
	console.error(`arecord terminó (${code}): sin micrófono en ${MIC}`);
	process.exit(1);
});
for (const signal of ['SIGTERM', 'SIGINT'] as const)
	process.on(signal, () => {
		mic.kill();
		process.exit(0);
	});

log(
	`Escuchando «hola casita» en ${MIC}, ${MIC_RATE} Hz × ${MIC_CHANNELS} (umbral ${THRESHOLD}, margen ${MARGIN_DB} dB); ${serverReady ? `órdenes a ${serverName}` : 'sin servidor: órdenes solo al log'}; ${speakerName ? `altavoz ${speakerName}` : 'sin altavoz'}; temporizadores: ${timers.describe().join('; ') || 'ninguno'}`
);
