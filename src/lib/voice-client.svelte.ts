import { goto } from '$app/navigation';
import { music } from '#lib/music-player.svelte.ts';
import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
import { recipe } from '#lib/recipe.svelte.ts';
import { timers } from '#lib/timers.svelte.ts';
import { musicTarget } from '#lib/music-target.svelte.ts';
import { videoHere } from '#lib/video-here.svelte.ts';
import {
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

class VoiceClient {
	phase = $state<'idle' | 'listening' | 'thinking'>('idle');
	heard = $state<string | null>(null);
	reply = $state<string | null>(null);
	options = $state<VoiceOption[]>([]);
	problem = $state<string | null>(null);
	/** Being read aloud: the header's bubble stays until it ends. */
	speaking = $state(false);
	/** The exchanges before, so that «no, eso no» means something. */
	#history: VoiceTurn[] = [];

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
		// A timer ringing stops (and what it paused plays again, to pause it now for the voice);
		// the press also lets the timers about to be set ring later.
		timers.silence();
		timers.unlockSound();
		videoHere.pauseForVoice();
		music.pauseForVoice();
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
		const res = await fetch('/api/voice/transcribe', { method: 'POST', body: audio }).catch(
			() => null
		);
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
		// Typed or tapped: that touch lets a timer set now ring later.
		timers.unlockSound();
		this.phase = 'thinking';
		this.problem = null;
		this.reply = null;
		this.options = [];
		this.heard = text;
		const res = await fetch('/api/voice/command', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				text,
				here: playingHere(),
				video: videoHere.position(),
				history: this.#history,
				timers: timers.describe(),
				recipe: recipe.describe()
			})
		}).catch(() => null);
		const body: VoiceReply | { message?: string } | null = await res?.json().catch(() => null);
		if (!res?.ok || !body || !('reply' in body))
			return this.#fail((body && 'message' in body && body.message) || 'Sin conexión');
		this.phase = 'idle';
		// Something else to watch: the episode that was paused stays so.
		if (body.actions.some((a) => a.kind === 'watch')) videoHere.forgetPause();
		// Something else to hear, or «para»: what was paused does not come back over it.
		if (body.actions.some((a) => ['play', 'radio', 'control'].includes(a.kind)))
			music.forgetPause();
		for (const action of body.actions) await act(action);
		this.reply = body.reply;
		this.options = body.options;
		kitchenLog.add(text, body.reply);
		this.#history = [
			...this.#history,
			{ role: 'user' as const, content: text },
			{ role: 'assistant' as const, content: body.reply }
		].slice(-HISTORY_TURNS);
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
		if (!('speechSynthesis' in window)) {
			resumeAfterVoice();
			return;
		}
		speechSynthesis.cancel();
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'es-ES';
		this.speaking = true;
		utterance.onend = utterance.onerror = () => {
			this.speaking = false;
			resumeAfterVoice();
		};
		speechSynthesis.speak(utterance);
	}
}

/** What was paused to speak, back where it was. */
function resumeAfterVoice() {
	videoHere.resumeAfterVoice();
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
			return kitchenMode.set(action.on);
		case 'prepareTimer':
			return timers.prepare(action.label, action.seconds, action.trigger);
		case 'cancelTimer':
			return void timers.cancel(action.label);
		case 'recipe':
			recipe.start(action.recipe, action.step);
			// Cooking: the screen stays on, to see the steps.
			return kitchenMode.set(true);
		case 'recipeStep':
			return recipe.go(action.step);
		case 'endRecipe':
			return recipe.end();
		case 'control':
			if (action.action === 'pause') return music.pause();
			if (action.action === 'resume') return music.resume();
			return music[action.action]();
	}
}

export const voice = new VoiceClient();
