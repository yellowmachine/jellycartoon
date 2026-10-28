import { music } from 'comun/music-player.svelte.ts';
import { musicTarget } from 'comun/music-target.svelte.ts';
import type { LngLat, Place } from 'comun/road.ts';
import {
	assistantTurn,
	HISTORY_IDLE_MS,
	HISTORY_TURNS,
	type VoiceAction,
	type VoiceOption,
	type VoiceReply,
	type VoiceTurn
} from 'comun/voice.ts';

/**
 * Voice commands in the cloud's road mode (#253), as jellycartoon's (src/lib/voice-client.svelte.ts
 * there): held down, it listens; let go, it is sent. What was said is heard by the house's Whisper
 * (/api/voz/oir) and done by the family's AI with the house's hands (/api/voz/orden); the answer
 * is shown and read aloud with the device's own voice. Only the button: no wake word here, no
 * timers, kitchen or videos.
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
	/** One of their saved routes (#151), from where we are. */
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
	/** Started by the wake word at home; never here, kept for the same page. */
	handsFree = $state(false);
	/** The road mode's page: where we are, the route on, and how to ask for one. */
	road: Road | null = null;
	/** The exchanges before, so that «no, eso no» means something; forgotten after a while. */
	#history: VoiceTurn[] = [];
	/** When the last answer came (Date.now()). */
	#historyAt = 0;
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

	/** With taps (Ajustes): the first starts, the next sends; one right after the first cancels. */
	toggle() {
		if (!this.#active) return void this.start();
		return this.stop();
	}

	async #send(audio: Blob) {
		this.phase = 'thinking';
		this.reply = null;
		this.options = [];
		const res = await fetch('/api/voz/oir', { method: 'POST', body: audio }).catch(() => null);
		const body = await res?.json().catch(() => null);
		if (!res?.ok) return this.#fail(body?.message ?? 'Sin conexión');
		if (!body.text) {
			this.heard = null;
			return this.#fail('No he oído nada. Prueba otra vez, más cerca.');
		}
		await this.command(body.text);
	}

	#fail(problem: string) {
		this.phase = 'idle';
		this.problem = problem;
		resumeAfterVoice();
	}

	/** Said or written: to the AI, and what it answers done here and read aloud. */
	async command(text: string) {
		this.phase = 'thinking';
		this.problem = null;
		this.reply = null;
		this.options = [];
		this.heard = text;
		if (Date.now() - this.#historyAt > HISTORY_IDLE_MS) this.#history = [];
		const res = await fetch('/api/voz/orden', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				text,
				here: playingHere(),
				video: null,
				history: this.#history,
				timers: [],
				recipe: null,
				car: true,
				position: this.road?.position() ?? null,
				navigation: this.road?.navigation() ?? null
			})
		}).catch(() => null);
		const body: VoiceReply | { message?: string } | null = await res?.json().catch(() => null);
		if (!res?.ok || !body || !('reply' in body))
			return this.#fail((body && 'message' in body && body.message) || 'Sin conexión');
		this.phase = 'idle';
		// Something else to hear, or «para»: what was paused does not come back over it.
		if (body.actions.some((a) => ['play', 'radio', 'control'].includes(a.kind)))
			music.forgetPause();
		for (const action of body.actions) await act(action);
		this.reply = body.reply;
		this.options = body.options;
		this.#history = [
			...this.#history,
			{ role: 'user' as const, content: text },
			assistantTurn(body)
		].slice(-HISTORY_TURNS);
		this.#historyAt = Date.now();
		this.#speak(body.reply);
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
		if (!('speechSynthesis' in window)) return resumeAfterVoice();
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'es-ES';
		this.speaking = true;
		// What it put on (or what plays) is heard under the answer, not over it; as the road mode.
		music.duck(true);
		utterance.onend = utterance.onerror = () => {
			this.speaking = false;
			// A cancelled answer ends as the next one starts: that one keeps it low.
			if (!speechSynthesis.speaking) music.duck(false);
			resumeAfterVoice();
		};
		speechSynthesis.speak(utterance);
	}
}

/** About to listen: what plays here pauses. */
function pauseForVoice() {
	music.pauseForVoice();
}

/** What was paused to speak, back where it was. */
function resumeAfterVoice() {
	music.resumeAfterVoice();
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
	if (!what) return null;
	const when = (at: number) =>
		new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
	return [
		what,
		!music.playing && !music.pausedForVoice ? ' (en pausa)' : '',
		music.stopAfterId !== null ? ' (se para al acabar esta canción)' : '',
		music.stopAt ? ` (se para a las ${when(music.stopAt)}, al acabar la canción de entonces)` : ''
	].join('');
}

/** What the server cannot do: play in this browser, and the road mode's route and camera. */
async function act(action: VoiceAction) {
	switch (action.kind) {
		case 'play':
			music.setShuffle(action.shuffle);
			return music.play(action.tracks, action.start);
		case 'radio':
			return musicTarget.playRadio(action.uuid, false);
		case 'navigate':
			return voice.road?.navigate(action.place);
		case 'route':
			return voice.road?.follow(action.id);
		case 'photo':
			return voice.road?.photo();
		case 'control':
			if (action.action === 'pause') return music.pause();
			if (action.action === 'resume') return music.resume();
			if (action.action === 'stopAfterTrack') return void music.stopAfterTrack();
			return music[action.action]();
		case 'stopIn':
			return music.stopIn(action.minutes);
		// Not here yet: the timers, the kitchen, videos.
	}
}

export const voice = new VoiceClient();
