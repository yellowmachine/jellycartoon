import { goto } from '$app/navigation';
import { music } from '#lib/music-player.svelte.ts';
import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
import { kitchenPanel } from '#lib/kitchen-panel.svelte.ts';
import { recipe } from '#lib/recipe.svelte.ts';
import { timers } from '#lib/timers.svelte.ts';
import { musicTarget } from '#lib/music-target.svelte.ts';
import { videoHere } from '#lib/video-here.svelte.ts';
import type { LngLat, Place } from '#lib/road.ts';
import {
	HISTORY_IDLE_MS,
	HISTORY_TURNS,
	type VoiceAction,
	type VoiceOption,
	type VoiceReply,
	type VoiceTurn
} from '#lib/voice.ts';

/**
 * Voice commands (#33) in the browser, for /voz and the header's microphone: held down, it
 * listens, as WhatsApp's voice notes; let go, it is sent. What was understood goes to the AI, which
 * does it; its answer is shown and read aloud. One for the whole app, so the conversation goes on
 * from one to the other.
 */

/**
 * Shorter than this, the button was tapped, not held: nothing was said. With taps (Ajustes), a
 * second tap this soon cancels it.
 */
const MIN_MS = 400;
/** Longer than this, it stops and sends by itself: a microphone forgotten open, with taps. */
const MAX_MS = 30_000;

/** What the road mode's page lends the voice (#78). */
export interface Road {
	position(): LngLat | null;
	/** The route on, described for the AI; null if none. */
	navigation(): string | null;
	/** A route to there; null, none. */
	navigate(place: Place | null): void;
	/** A route kept in Viajes (#151), by its id. */
	follow(id: number): void;
	/** A photo with its camera. */
	photo(): void;
}

class VoiceClient {
	phase = $state<'idle' | 'listening' | 'thinking'>('idle');
	heard = $state<string | null>(null);
	reply = $state<string | null>(null);
	options = $state<VoiceOption[]>([]);
	problem = $state<string | null>(null);
	/** Being read aloud: the header's bubble stays until it ends. */
	speaking = $state(false);
	/** Started by the wake word (#144): no button to let go, it ends after a silence. */
	handsFree = $state(false);
	/**
	 * In the road mode (#78), set by its page: the AI is told, nothing to watch is opened, and its
	 * route is asked for and shown there. Null elsewhere.
	 */
	road: Road | null = null;
	/** The exchanges before, so that «no, eso no» means something; forgotten after a while. */
	#history: VoiceTurn[] = [];
	/** When the last answer came (Date.now()). */
	#historyAt = 0;
	/**
	 * This order's moments (performance.now()), from the end of what was said: to the Registro,
	 * once the answer starts to sound, to know where the time goes.
	 */
	#timing: {
		ended: number;
		transcribed?: number;
		answered?: number;
		handsFree: boolean;
		text?: string;
	} | null = null;

	#recorder: MediaRecorder | null = null;
	#chunks: Blob[] = [];
	/** When the button was pressed, not when the microphone was ready. */
	#pressed = 0;
	/** Let go before the microphone was ready: it stops as soon as it is. */
	#released = false;
	/** A tap, not speech: what was recorded, if anything, is thrown away. */
	#discard = false;
	/** Pressed and not let go yet (or, with taps, not tapped again): asking for the microphone too. */
	#active = false;
	#limit: ReturnType<typeof setTimeout> | undefined;

	/** Pressed: what plays here (an episode, music, a podcast) pauses, and the microphone listens. */
	async start() {
		if (this.phase !== 'idle' || this.#active) return;
		this.#active = true;
		this.#pressed = performance.now();
		this.#released = false;
		this.#discard = false;
		clearTimeout(this.#limit);
		this.#limit = setTimeout(() => this.stop(), MAX_MS);
		this.problem = null;
		pauseForVoice();
		let stream: MediaStream;
		try {
			// https://developer.mozilla.org/docs/Web/API/MediaDevices/getUserMedia
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch {
			this.#active = false;
			clearTimeout(this.#limit);
			resumeAfterVoice();
			// Let go already: it was a tap, and whoever tapped is told nothing.
			if (!this.#discard)
				this.problem = 'No se puede usar el micrófono. Hay que darle permiso a la página.';
			return;
		}
		// The browser's own format: WebM/Opus on Android, MP4/AAC on iPhone. Whisper takes both.
		const recorder = new MediaRecorder(stream);
		this.#recorder = recorder;
		this.#chunks = [];
		recorder.ondataavailable = (e) => this.#chunks.push(e.data);
		recorder.onstop = () => {
			// The microphone off, and its icon gone from the phone's bar.
			for (const track of stream.getTracks()) track.stop();
			this.#recorder = null;
			if (this.#discard) {
				this.phase = 'idle';
				return;
			}
			void this.#send(new Blob(this.#chunks, { type: recorder.mimeType }));
		};
		recorder.start();
		this.phase = 'listening';
		if (this.#released) recorder.stop();
	}

	/**
	 * Let go: what was said is sent. `'tap'` if it was too short to be speech: nothing is sent, and
	 * the episode goes on.
	 */
	stop(): 'sent' | 'tap' {
		this.#timing = { ended: performance.now(), handsFree: false };
		this.#active = false;
		clearTimeout(this.#limit);
		this.#released = true;
		const tap = performance.now() - this.#pressed < MIN_MS;
		if (tap) {
			this.#discard = true;
			resumeAfterVoice();
		}
		if (this.#recorder?.state === 'recording') this.#recorder.stop();
		return tap ? 'tap' : 'sent';
	}

	/**
	 * The wake word heard (#144): as pressing the button, but what is said comes from the wake word's
	 * listener, which already has the microphone. False if busy (listening, thinking or speaking).
	 */
	beginHandsFree(): boolean {
		if (this.phase !== 'idle' || this.#active || this.speaking) return false;
		this.handsFree = true;
		this.problem = null;
		pauseForVoice();
		this.phase = 'listening';
		return true;
	}

	/** What was said after it (a WAV); null if nothing was, and what was paused plays again. */
	endHandsFree(audio: Blob | null) {
		if (!this.handsFree) return;
		this.handsFree = false;
		// After the silence that ended it (vad.ts), not when the voice stopped.
		this.#timing = { ended: performance.now(), handsFree: true };
		if (audio) return void this.#send(audio);
		this.phase = 'idle';
		resumeAfterVoice();
	}

	/** With taps (Ajustes): the first starts, the next sends; one right after the first cancels. */
	toggle() {
		if (!this.#active) return void this.start();
		return this.stop();
	}

	async #send(audio: Blob) {
		this.phase = 'thinking';
		this.reply = null;
		this.options = [];
		const res = await fetch('/api/voice/transcribe', { method: 'POST', body: audio }).catch(
			() => null
		);
		const body = await res?.json().catch(() => null);
		if (!res?.ok) return this.#fail(body?.message ?? 'Sin conexión');
		if (!body.text) {
			this.heard = null;
			return this.#fail('No he oído nada. Prueba otra vez, más cerca.');
		}
		if (this.#timing) this.#timing.transcribed = performance.now();
		await this.command(body.text);
	}

	#fail(problem: string) {
		this.#timing = null;
		this.phase = 'idle';
		this.problem = problem;
		resumeAfterVoice();
	}

	/** Said or written: to the AI, and what it answers done here and read aloud. */
	async command(text: string) {
		// Typed or tapped: that touch lets a timer set now ring later.
		timers.unlockSound();
		this.phase = 'thinking';
		this.problem = null;
		this.reply = null;
		this.options = [];
		this.heard = text;
		// Written, or an option tapped: from now.
		if (this.#timing?.transcribed === undefined)
			this.#timing = { ended: performance.now(), handsFree: false };
		this.#timing.text = text;
		if (Date.now() - this.#historyAt > HISTORY_IDLE_MS) this.#history = [];
		const res = await fetch('/api/voice/command', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				text,
				here: playingHere(),
				video: videoHere.position(),
				history: this.#history,
				timers: timers.describe(),
				recipe: recipe.describe(),
				car: this.road !== null,
				position: this.road?.position() ?? null,
				navigation: this.road?.navigation() ?? null
			})
		}).catch(() => null);
		const body: VoiceReply | { message?: string } | null = await res?.json().catch(() => null);
		if (!res?.ok || !body || !('reply' in body))
			return this.#fail((body && 'message' in body && body.message) || 'Sin conexión');
		this.#timing.answered = performance.now();
		this.phase = 'idle';
		// Something else to watch: the episode that was paused stays so.
		if (body.actions.some((a) => a.kind === 'watch')) videoHere.forgetPause();
		// Something else to hear, or «para»: what was paused does not come back over it.
		if (body.actions.some((a) => ['play', 'radio', 'control'].includes(a.kind)))
			music.forgetPause();
		for (const action of body.actions) {
			// Driving: never a video, whatever the answer says.
			if (this.road && action.kind === 'watch') continue;
			await act(action);
		}
		this.reply = body.reply;
		this.options = body.options;
		kitchenLog.add(text, body.reply);
		this.#history = [
			...this.#history,
			{ role: 'user' as const, content: text },
			{ role: 'assistant' as const, content: body.reply }
		].slice(-HISTORY_TURNS);
		this.#historyAt = Date.now();
		this.#speak(body.reply);
	}

	/** This order's times, to the Registro: from the end of what was said to the answer heard. */
	#report() {
		const t = this.#timing;
		this.#timing = null;
		if (!t?.answered) return;
		const now = performance.now();
		const body = {
			text: t.text,
			handsFree: t.handsFree,
			total: now - t.ended,
			transcribe: t.transcribed === undefined ? null : t.transcribed - t.ended,
			command: t.answered - (t.transcribed ?? t.ended),
			speak: now - t.answered
		};
		void fetch('/api/voice/tiempos', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => {});
	}

	/** The answer and the question it may be, gone: the header's bubble closes. */
	dismiss() {
		this.reply = null;
		this.options = [];
		this.problem = null;
		this.heard = null;
	}

	/**
	 * Read aloud with the device's own voice; the episode that was paused plays again once it ends:
	 * https://developer.mozilla.org/docs/Web/API/SpeechSynthesis
	 */
	#speak(text: string) {
		if (!('speechSynthesis' in window)) {
			this.#report();
			resumeAfterVoice();
			return;
		}
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'es-ES';
		this.speaking = true;
		// What it put on (or what plays) is heard under the answer, not over it; as the road mode.
		music.duck(true);
		utterance.onstart = () => this.#report();
		utterance.onend = utterance.onerror = () => {
			this.speaking = false;
			// A cancelled answer ends as the next one starts: that one keeps it low.
			if (!speechSynthesis.speaking) music.duck(false);
			resumeAfterVoice();
		};
		speechSynthesis.speak(utterance);
	}
}

/**
 * About to listen: a timer ringing stops (and what it paused plays again, to pause it now for the
 * voice), and what plays here pauses. A press also lets the timers about to be set ring later.
 */
function pauseForVoice() {
	timers.silence();
	timers.unlockSound();
	videoHere.pauseForVoice();
	music.pauseForVoice();
	duckLivingRoom(true);
}

/** What was paused to speak, back where it was. */
function resumeAfterVoice() {
	videoHere.resumeAfterVoice();
	music.resumeAfterVoice();
	duckLivingRoom(false);
}

/**
 * The living room's TV (mpv) lower while speaking and answering, from whichever device: with a
 * series on, the order never reached a silence. Without mpv, or nothing on, nothing happens.
 */
let ducking = false;
function duckLivingRoom(on: boolean) {
	if (on === ducking) return;
	ducking = on;
	void fetch('/api/salon/bajar', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ on }),
		keepalive: true
	}).catch(() => {});
}

/**
 * What sounds on this device, for the AI: «quita eso» is about it. Paused only to speak, it is
 * still what the person is listening to.
 */
function playingHere() {
	const what = music.radio
		? `la radio ${music.radio.name}`
		: music.podcast
			? `el podcast «${music.podcast.podcastTitle}», episodio «${music.podcast.title}»`
			: music.current
				? `«${music.current.title}» de ${music.current.artist}`
				: null;
	return what && !music.playing && !music.pausedForVoice ? `${what} (en pausa)` : what;
}

/** What the server cannot do: play in this browser. */
async function act(action: VoiceAction) {
	switch (action.kind) {
		case 'watch':
			// The answer is still read aloud: speechSynthesis outlives the page change.
			return goto(
				`/watch/${action.episodeId}${action.startSec === null ? '' : `?t=${action.startSec}`}`
			);
		case 'play':
			music.setShuffle(action.shuffle);
			return music.play(action.tracks, action.start);
		case 'radio':
			return musicTarget.playRadio(action.uuid, false);
		case 'timer':
			return timers.start(action.label, action.seconds);
		case 'kitchenMode':
			// Turned on from another page (the news playing): the kitchen opens over it.
			if (action.on) kitchenPanel.show();
			return kitchenMode.set(action.on);
		case 'prepareTimer':
			return timers.prepare(action.label, action.seconds, action.trigger);
		case 'cancelTimer':
			return void timers.cancel(action.label);
		case 'recipe':
			recipe.start(action.recipe, action.step);
			// Cooking: the screen stays on, to see the steps, over the page that is on.
			kitchenPanel.show();
			return kitchenMode.set(true);
		case 'recipeStep':
			return recipe.go(action.step);
		case 'endRecipe':
			return recipe.end();
		case 'navigate':
			return voice.road?.navigate(action.place);
		case 'route':
			return voice.road?.follow(action.id);
		case 'photo':
			return voice.road?.photo();
		case 'control':
			if (action.action === 'pause') return music.pause();
			if (action.action === 'resume') return music.resume();
			return music[action.action]();
	}
}

export const voice = new VoiceClient();
