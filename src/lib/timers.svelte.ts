import { music } from '#lib/music-player.svelte.ts';
import { kitchenLog } from '#lib/kitchen-log.svelte.ts';
import { recipe } from '#lib/recipe.svelte.ts';
import { sameLabel, spokenLeft, timeLabel } from '#lib/timer-names.ts';

/**
 * Kitchen timers (#60), set by voice («avísame en 10 minutos para la pasta»): in this browser,
 * each with its name, shown in the header counting down. At the end a chime rings until it is
 * stopped, and what plays here pauses meanwhile. Kept in this browser (localStorage), so that
 * reloading the page does not lose them.
 *
 * Also prepared ones, waiting for something: «cuando hierva, pon 8 minutos para la pasta». The AI
 * gets them with each command and starts one when told «ya hierve»; a tap on it starts it too.
 */

export interface Timer {
	id: string;
	/** As it was said: «la pasta», «el horno»; its time if none, «5 minutos». */
	label: string;
	/** When it ends, in ms (Date.now()). */
	endsAt: number;
}

/** Waiting to be started, by voice or by a tap. */
export interface PreparedTimer {
	id: string;
	label: string;
	seconds: number;
	/** What it waits for, as the AI wrote it: «hierva el agua», «esté hecho el sofrito». */
	trigger: string;
}

/**
 * How long one that rang and was stopped, or was taken away, is still told to the AI: with the
 * conversation before it sees «avísame en 2 minutos», and without this it would set it again.
 */
const RECENT_MS = 30 * 60_000;

/** More than this ringing, it stops sounding (it still shows): no one is in the kitchen. */
const RING_MAX_MS = 3 * 60_000;
/** One chime every so often while it rings. */
const CHIME_EVERY_MS = 2500;
const STORAGE_KEY = 'kitchen-timers';
const PREPARED_KEY = 'kitchen-timers-prepared';
/** What the AI may still call one with no name: as if it had none. */
const DEFAULT_LABEL = 'temporizador';

class Timers {
	list = $state<Timer[]>([]);
	prepared = $state<PreparedTimer[]>([]);
	/** Rang and stopped, or taken away, lately: only for the AI (see RECENT_MS). */
	#done: { label: string; how: 'sonó' | 'quitado'; at: number }[] = [];
	/** Those that got to their end and were not stopped yet. */
	ringing = $state<Timer[]>([]);
	/** Ticks every second while there is any: what the countdowns are drawn from. */
	now = $state(Date.now());

	#tick: ReturnType<typeof setInterval> | undefined;
	#chime: ReturnType<typeof setInterval> | undefined;
	#ringStarted = 0;
	#audio: AudioContext | null = null;
	#loaded = false;

	/** The ones saved in this browser; those that ended while it was closed, ringing. */
	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		try {
			const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
			if (Array.isArray(saved))
				this.list = saved.filter(
					(t): t is Timer =>
						typeof t?.id === 'string' && typeof t.label === 'string' && Number.isFinite(t.endsAt)
				);
			const prepared = JSON.parse(localStorage.getItem(PREPARED_KEY) ?? '[]');
			if (Array.isArray(prepared))
				this.prepared = prepared.filter(
					(t): t is PreparedTimer =>
						typeof t?.id === 'string' &&
						typeof t.label === 'string' &&
						typeof t.trigger === 'string' &&
						Number.isFinite(t.seconds)
				);
		} catch {
			// Private windows, or something else saved there.
		}
		this.#update();
	}

	#save() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.list));
			localStorage.setItem(PREPARED_KEY, JSON.stringify(this.prepared));
		} catch {
			// Same.
		}
	}

	/**
	 * Sound can only start after the user touches the page: called on the microphone's press, so
	 * that a timer set by voice rings later.
	 * https://developer.mozilla.org/docs/Web/API/Web_Audio_API/Best_practices#autoplay_policy
	 */
	unlockSound() {
		try {
			this.#audio ??= new AudioContext();
			void this.#audio.resume();
		} catch {
			// No Web Audio: it only shows.
		}
	}

	/**
	 * A new one; one with the same name starts over with the new time. A prepared one with that
	 * name is the one starting: it is no longer waiting.
	 */
	start(label: string, seconds: number) {
		label = this.#name(label, seconds);
		const timer = { id: crypto.randomUUID(), label, endsAt: Date.now() + seconds * 1000 };
		this.list = [...this.list.filter((t) => !sameLabel(t.label, label)), timer];
		this.ringing = this.ringing.filter((t) => !sameLabel(t.label, label));
		this.prepared = this.prepared.filter((t) => !sameLabel(t.label, label));
		this.#save();
		this.#update();
	}

	/** Waiting for `trigger`; one with the same name is replaced. */
	prepare(label: string, seconds: number, trigger: string) {
		label = this.#name(label, seconds);
		this.prepared = [
			...this.prepared.filter((t) => !sameLabel(t.label, label)),
			{ id: crypto.randomUUID(), label, seconds, trigger: trigger.trim() }
		];
		this.#save();
	}

	/**
	 * The name it goes by. Without one, its time («5 minutos»), and «5 minutos (2)» if that one is
	 * taken: two with no name are two timers, not one replacing the other. With one, as said, so
	 * that «pon 10 minutos para la pasta» again starts the pasta's over.
	 */
	#name(label: string, seconds: number) {
		label = label.trim();
		if (label && !sameLabel(label, DEFAULT_LABEL)) return label;
		const base = timeLabel(seconds);
		const taken = (name: string) =>
			[...this.list, ...this.ringing, ...this.prepared].some((t) => sameLabel(t.label, name));
		let name = base;
		for (let n = 2; taken(name); n++) name = `${base} (${n})`;
		return name;
	}

	/** Tapped: the prepared one starts now. */
	startPrepared(id: string) {
		const timer = this.prepared.find((t) => t.id === id);
		if (timer) this.start(timer.label, timer.seconds);
	}

	/** That one (by its name), or all of them with null, running or prepared; how many went. */
	cancel(label: string | null) {
		const gone = (t: { label: string }) => label === null || sameLabel(t.label, label);
		const count =
			this.list.filter(gone).length +
			this.ringing.filter(gone).length +
			this.prepared.filter(gone).length;
		this.#remember([...this.list, ...this.prepared].filter(gone), 'quitado');
		this.#remember(this.ringing.filter(gone), 'sonó');
		this.list = this.list.filter((t) => !gone(t));
		this.ringing = this.ringing.filter((t) => !gone(t));
		this.prepared = this.prepared.filter((t) => !gone(t));
		this.#save();
		this.#update();
		return count;
	}

	/** Touched, or the microphone pressed: the ringing ones stop. */
	silence() {
		if (!this.ringing.length) return;
		this.#remember(this.ringing, 'sonó');
		this.ringing = [];
		this.#update();
	}

	#remember(gone: { label: string }[], how: 'sonó' | 'quitado') {
		const at = Date.now();
		this.#done = [
			...this.#done.filter(
				(d) => at - d.at < RECENT_MS && !gone.some((g) => sameLabel(g.label, d.label))
			),
			...gone.map((g) => ({ label: g.label, how, at }))
		];
	}

	/** For the AI, with each command: «¿cuánto le queda?» is answered from it. */
	describe() {
		const now = Date.now();
		const done = this.#done.filter(
			(d) =>
				now - d.at < RECENT_MS &&
				![...this.list, ...this.ringing, ...this.prepared].some((t) => sameLabel(t.label, d.label))
		);
		return [
			...done.map(
				(d) =>
					`${d.label}, ya ${d.how === 'sonó' ? 'sonó y se paró' : 'se quitó'} hace ${spokenLeft((now - d.at) / 1000)}: no lo vuelvas a poner si no lo pide`
			),
			...this.list.map((t) => `${t.label}, quedan ${spokenLeft((t.endsAt - now) / 1000)}`),
			...this.ringing.map((t) => `${t.label}, ya ha terminado y está sonando`),
			...this.prepared.map(
				(t) => `${t.label}, ${spokenLeft(t.seconds)}, preparado: arranca cuando ${t.trigger}`
			)
		];
	}

	/** What ended rings; the ticking and the chime, only while needed. */
	#update() {
		this.now = Date.now();
		const ended = this.list.filter((t) => t.endsAt <= this.now);
		if (ended.length) {
			this.list = this.list.filter((t) => t.endsAt > this.now);
			this.#save();
			this.#ring(ended);
		}
		if (this.list.length && !this.#tick) this.#tick = setInterval(() => this.#update(), 1000);
		if (!this.list.length && this.#tick) {
			clearInterval(this.#tick);
			this.#tick = undefined;
		}
		if (!this.ringing.length && this.#chime) {
			clearInterval(this.#chime);
			this.#chime = undefined;
			music.resumeAfterVoice();
		}
	}

	#ring(ended: Timer[]) {
		this.ringing = [...this.ringing, ...ended];
		music.pauseForVoice();
		this.#ringStarted = Date.now();
		clearInterval(this.#chime);
		this.#playChime();
		this.#chime = setInterval(() => {
			if (Date.now() - this.#ringStarted > RING_MAX_MS) {
				clearInterval(this.#chime);
				this.#chime = undefined;
				return;
			}
			this.#playChime();
		}, CHIME_EVERY_MS);
		// The recipe being cooked goes on to the step after it (#60), and says it.
		const next = recipe.afterTimers(ended.map((t) => t.label));
		const text = `Ya está: ${ended.map((t) => t.label).join(' y ')}.${next ? ` ${next}` : ''}`;
		// In the kitchen's session, written: whether or not it was heard.
		kitchenLog.add(null, text);
		// Said once too, after the first chime: which one it is, and what to do now.
		setTimeout(() => {
			if (!this.ringing.length || !('speechSynthesis' in window)) return;
			const said = new SpeechSynthesisUtterance(text);
			said.lang = 'es-ES';
			speechSynthesis.speak(said);
		}, 1200);
		navigator.vibrate?.([300, 150, 300]);
	}

	/**
	 * Two soft notes, high then low («din-don»), as a kitchen timer: sine waves that fade, made by
	 * the browser itself (no sound file).
	 */
	#playChime() {
		const ctx = this.#audio;
		if (!ctx || ctx.state !== 'running') return;
		const t = ctx.currentTime;
		for (const [freq, start] of [
			[880, 0],
			[660, 0.35]
		] as const) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = 'sine';
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.0001, t + start);
			gain.gain.exponentialRampToValueAtTime(0.4, t + start + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.9);
			osc.connect(gain).connect(ctx.destination);
			osc.start(t + start);
			osc.stop(t + start + 1);
		}
	}
}

export const timers = new Timers();
