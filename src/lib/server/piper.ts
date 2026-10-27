import { PIPER_URL, PIPER_VOICE_EN, PIPER_VOICE_ES } from '$app/env/private';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';

/**
 * Piper's HTTP server on the PC with the app (deploy/jellycartoon-piper.service): text read aloud,
 * as a WAV. The DJ's voice without OpenRouter (music/dj.ts), and the voice satellites' answers
 * (#223, /api/voice/speak) in the house's voice, chosen in Ajustes → Casa among those installed.
 */

export const piperEnabled = Boolean(PIPER_URL);

/** Quite enough for the words of a talk; Piper says them in a second or two. */
const TIMEOUT_MS = 60_000;
/** Piper's own names: `es_ES-sharvard-medium`, and a speaker such as `F`. */
const NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** A voice, and one of its speakers when it has several (sharvard: `M` and `F`). */
export interface PiperVoice {
	voice: string;
	speaker: string | null;
}

const base = () => PIPER_URL!.replace(/\/+$/, '');

export const isPiperVoice = (v: unknown): v is PiperVoice =>
	Boolean(v) &&
	typeof (v as PiperVoice).voice === 'string' &&
	NAME.test((v as PiperVoice).voice) &&
	((v as PiperVoice).speaker === null ||
		(typeof (v as PiperVoice).speaker === 'string' && NAME.test((v as PiperVoice).speaker!)));

/**
 * `voice`: if not given, the one in .env for `lang` (the DJ's). `style`, how it reads (the house's
 * «Expresividad» and «Velocidad», voice-levels.ts `piperStyle`); its own way if not given.
 */
export async function piper(
	text: string,
	lang: 'es' | 'en' = 'es',
	voice?: PiperVoice,
	style: Record<string, number> = {}
) {
	if (!PIPER_URL) throw new Error('No hay Piper (PIPER_URL)');
	const chosen = voice ?? { voice: lang === 'en' ? PIPER_VOICE_EN : PIPER_VOICE_ES, speaker: null };
	const res = await fetch(`${base()}/synthesize`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			text,
			...style,
			voice: chosen.voice,
			...(chosen.speaker ? { speaker: chosen.speaker } : {})
		}),
		signal: AbortSignal.timeout(TIMEOUT_MS)
	}).catch((err) => {
		throw new Error(`No se pudo hablar con Piper: ${err instanceof Error ? err.message : err}`);
	});
	if (!res.ok) throw new Error(`Piper: ${(await res.text()).slice(0, 200) || res.statusText}`);
	return new Uint8Array(await res.arrayBuffer());
}

const COUNTRIES: Record<string, string> = { ES: 'España', MX: 'México', AR: 'Argentina' };

export interface VoiceOption extends PiperVoice {
	/** «sharvard F», «davefx». */
	label: string;
	country: string;
}

/** The Spanish voices installed with Piper, one per speaker, to choose in Ajustes. */
export async function spanishVoices() {
	const res = await fetch(`${base()}/voices`, { signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`Piper respondió ${res.status}`);
	const all = (await res.json()) as Record<
		string,
		{
			language?: { family?: string; region?: string };
			speaker_id_map?: Record<string, number>;
		}
	>;
	return Object.entries(all)
		.filter(([, v]) => v.language?.family === 'es')
		.flatMap(([voice, v]): VoiceOption[] => {
			const country = COUNTRIES[v.language?.region ?? ''] ?? v.language?.region ?? '';
			// «es_ES-sharvard-medium»: «sharvard», how it is told apart.
			const name = voice.split('-')[1] ?? voice;
			const speakers = Object.keys(v.speaker_id_map ?? {});
			return speakers.length
				? speakers.map((speaker) => ({ voice, speaker, label: `${name} ${speaker}`, country }))
				: [{ voice, speaker: null, label: name, country }];
		})
		.sort((a, b) => a.country.localeCompare(b.country) || a.label.localeCompare(b.label));
}

/** The house's voice for the satellites: chosen in Ajustes, or PIPER_VOICE_ES. */
export async function houseVoice(): Promise<PiperVoice> {
	try {
		const saved = JSON.parse((await getAppSetting('house_voice')) ?? 'null');
		if (isPiperVoice(saved)) return saved;
	} catch {
		// Not saved well: the default.
	}
	return { voice: PIPER_VOICE_ES, speaker: null };
}

export async function setHouseVoice(voice: PiperVoice | null) {
	await setAppSetting('house_voice', voice ? JSON.stringify(voice) : null);
}
