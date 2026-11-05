import { invalidateAll } from '$app/navigation';
import { music } from 'comun/music-player.svelte.ts';
import { metresBetween } from 'comun/road-guide.ts';
import { noteRecorder } from '#lib/note-recorder.svelte.ts';
import { addPoints, type StoredPoint, type TripPoint } from '#lib/trips.ts';
import {
	attachmentsOf,
	dropWalkAttachments,
	keepAttachment,
	sendAttachments,
	type Attachment
} from '#lib/walk-attachments.ts';
import {
	FASTEST_WALK,
	GAP_AFTER_MS,
	MAX_POINTS,
	dueCue,
	noCues,
	noDiagnosis,
	noPlan,
	parsePlan,
	worthWalking,
	type WalkCues,
	type WalkDiagnosis,
	type WalkPlan
} from '#lib/walks.ts';

/**
 * The walk going on (#410), on this device: everything stays in localStorage until the server has
 * it, so neither a walk without signal nor a page the phone closes loses it. Walks on across the
 * app's pages, and goes on by itself if the page is opened again. Writes down what the GPS does, to
 * see whether it goes on with the screen off.
 */

/** Without a position kept, what is known is written down this often. */
const SAVE_EVERY_MS = 15_000;
/** How often it looks whether the voice has something to say. */
const CUE_CHECK_MS = 1000;
/** The music back up if the browser never says the voice ended, as happens on some phones. */
const DUCK_AT_MOST_MS = 15_000;

interface Kept {
	startedAt: number;
	endedAt: number | null;
	distance: number;
	points: TripPoint[];
	diagnosis: WalkDiagnosis;
	lastFix: TripPoint | null;
	hiddenAt: number | null;
	hiddenInGap: boolean;
	musicInGap: boolean;
	/** Missing in a walk kept before these existed. */
	plan?: WalkPlan;
	cues?: WalkCues;
}

class WalkRecorder {
	startedAt = $state<number | null>(null);
	/** Finished and not at the server yet. */
	endedAt = $state<number | null>(null);
	distance = $state(0);
	sending = $state(false);
	/** Why it cannot, if it cannot. */
	problem = $state<string | null>(null);
	/** Whether the GPS has said anything yet. */
	located = $state(false);
	/** What the next walk does, or this one. */
	plan = $state<WalkPlan>(noPlan());
	/** Taken on this walk, waiting on this device until it is sent. */
	photos = $state(0);
	notes = $state(0);

	#cues = noCues();
	#cueTimer: ReturnType<typeof setInterval> | null = null;
	#duckTimer: ReturnType<typeof setTimeout> | undefined;
	#userId: string | null = null;
	#points: TripPoint[] = [];
	#diagnosis = noDiagnosis();
	#lastFix: TripPoint | null = null;
	#hiddenAt: number | null = null;
	#hiddenInGap = false;
	#musicInGap = false;
	#reopened = false;
	#savedAt = 0;
	#watch: number | null = null;

	get recording() {
		return this.startedAt !== null && this.endedAt === null;
	}

	get #key() {
		return `paseo:${this.#userId}`;
	}

	get #planKey() {
		return `paseo-plan:${this.#userId}`;
	}

	/** Changed before starting: remembered for the next walk. */
	choose(change: Partial<WalkPlan>) {
		this.plan = { ...this.plan, ...change };
		try {
			localStorage.setItem(this.#planKey, JSON.stringify(this.plan));
		} catch {
			// Private window: chosen for this one only.
		}
	}

	/** At the start, for who is signed in: a walk left going on goes on; a finished one is sent. */
	open(userId: string) {
		if (this.#userId === userId) return;
		this.#stopWatching();
		this.#reset();
		this.#userId = userId;
		this.plan = this.#readPlan();
		const kept = this.#read();
		if (!kept) return;
		this.plan = kept.plan ? parsePlan(kept.plan) : this.plan;
		this.#cues = kept.cues ?? noCues();
		this.startedAt = kept.startedAt;
		this.endedAt = kept.endedAt;
		this.distance = kept.distance;
		this.#points = kept.points;
		this.#diagnosis = kept.diagnosis;
		this.#lastFix = kept.lastFix;
		this.#hiddenAt = kept.hiddenAt;
		this.#hiddenInGap = kept.hiddenInGap;
		this.#musicInGap = kept.musicInGap;
		this.#reopened = true;
		if (this.recording) {
			this.#countHidden();
			this.#startWatching();
		} else void this.send();
		void this.#countAttachments();
	}

	/** A photo or a note of this walk, where it is now; kept on this device until the walk is sent. */
	async attach(kind: Attachment['kind'], blob: Blob) {
		if (!this.recording || !this.#userId) return;
		try {
			await keepAttachment({
				userId: this.#userId,
				kind,
				blob,
				at: Date.now(),
				position: this.#lastFix?.at ?? null,
				walk: this.startedAt
			});
		} catch {
			this.problem = 'No se ha podido guardar en este móvil: quizá no le queda sitio.';
			return;
		}
		await this.#countAttachments();
	}

	async #countAttachments() {
		if (!this.#userId) return;
		const all = await attachmentsOf(this.#userId).catch(() => []);
		const mine = all.filter((a) => a.walk === this.startedAt);
		this.photos = mine.filter((a) => a.kind === 'foto').length;
		this.notes = mine.filter((a) => a.kind === 'nota').length;
		// What is left of walks already at the server.
		if (all.length > mine.length)
			void sendAttachments(this.#userId, this.startedAt).catch(() => {});
	}

	start() {
		if (this.startedAt !== null) return;
		this.#reset();
		this.startedAt = Date.now();
		this.#hiddenInGap = document.hidden;
		this.#musicInGap = music.playing;
		this.#save();
		this.#startWatching();
		// Said within the press: browsers let a page speak only after one.
		if (this.plan.every || this.plan.goal) this.#say('Paseo empezado.');
	}

	async finish() {
		if (!this.recording) return;
		this.#stopWatching();
		this.#countHidden();
		this.endedAt = Date.now();
		this.#save();
		await this.send();
	}

	/** The finished walk, to the server; it stays here if it does not get there. */
	async send() {
		if (this.sending || this.endedAt === null) return;
		this.sending = true;
		const res = await fetch('/paseos/guardar', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				startedAt: this.startedAt,
				endedAt: this.endedAt,
				points: this.#points,
				diagnosis: this.#diagnosis
			})
		}).catch(() => null);
		this.sending = false;
		if (!res?.ok) {
			this.problem = 'No se ha podido enviar: el paseo sigue guardado en este móvil.';
			return;
		}
		const userId = this.#userId;
		this.#forget();
		// Its photos and notes now: heard one by one, so as not to hold up the walk being kept.
		await invalidateAll();
		const sent = userId ? await sendAttachments(userId).catch(() => 0) : 0;
		if (sent) await invalidateAll();
	}

	/** Thrown away, going on or not sent. */
	discard() {
		this.#stopWatching();
		if (this.#userId && this.startedAt !== null)
			void dropWalkAttachments(this.#userId, this.startedAt).catch(() => {});
		this.#forget();
	}

	#forget() {
		try {
			localStorage.removeItem(this.#key);
		} catch {
			// Private window: it was not kept either.
		}
		this.#reset();
	}

	#reset() {
		this.startedAt = null;
		this.endedAt = null;
		this.distance = 0;
		this.problem = null;
		this.located = false;
		this.#points = [];
		this.#diagnosis = noDiagnosis();
		this.#lastFix = null;
		this.#hiddenAt = null;
		this.#hiddenInGap = false;
		this.#musicInGap = false;
		this.#reopened = false;
		this.#cues = noCues();
		this.photos = 0;
		this.notes = 0;
	}

	#readPlan() {
		try {
			return parsePlan(JSON.parse(localStorage.getItem(this.#planKey) ?? 'null'));
		} catch {
			return noPlan();
		}
	}

	#read(): Kept | null {
		try {
			return JSON.parse(localStorage.getItem(this.#key) ?? 'null');
		} catch {
			return null;
		}
	}

	#save() {
		this.#savedAt = Date.now();
		try {
			localStorage.setItem(
				this.#key,
				JSON.stringify({
					startedAt: this.startedAt!,
					endedAt: this.endedAt,
					distance: this.distance,
					points: this.#points,
					diagnosis: this.#diagnosis,
					lastFix: this.#lastFix,
					hiddenAt: this.#hiddenAt,
					hiddenInGap: this.#hiddenInGap,
					musicInGap: this.#musicInGap,
					plan: this.plan,
					cues: this.#cues
				} satisfies Kept)
			);
		} catch {
			this.problem = 'Este navegador no deja guardarlo: si se cierra la página, se pierde.';
		}
	}

	#startWatching() {
		this.#cueTimer ??= setInterval(this.#checkCue, CUE_CHECK_MS);
		if (!('geolocation' in navigator)) {
			this.problem = 'Este navegador no da la posición: solo se cuenta el tiempo.';
			return;
		}
		this.#watchGps();
		document.addEventListener('visibilitychange', this.#onVisibility);
		addEventListener('pagehide', this.#onLeave);
	}

	#stopWatching() {
		if (this.#cueTimer !== null) clearInterval(this.#cueTimer);
		this.#cueTimer = null;
		this.#clearGps();
		document.removeEventListener('visibilitychange', this.#onVisibility);
		removeEventListener('pagehide', this.#onLeave);
	}

	#watchGps() {
		this.#clearGps();
		this.#watch = navigator.geolocation.watchPosition(
			({ coords, timestamp }) =>
				this.#onFix(
					{ t: timestamp, at: [coords.longitude, coords.latitude], speed: coords.speed },
					coords.accuracy
				),
			(err) => {
				if (err.code === err.PERMISSION_DENIED)
					this.problem = 'Sin permiso para la posición: solo se cuenta el tiempo.';
			},
			{ enableHighAccuracy: true, maximumAge: 2000 }
		);
	}

	#clearGps() {
		if (this.#watch !== null) navigator.geolocation.clearWatch(this.#watch);
		this.#watch = null;
	}

	#onFix(fix: TripPoint, accuracy: number | null) {
		// From before it started (the browser's last known), or out of order.
		if (fix.t < this.startedAt! || (this.#lastFix && fix.t <= this.#lastFix.t)) return;
		this.located = true;
		this.problem = null;
		const d = this.#diagnosis;
		const hidden = document.hidden;
		let changed = false;
		if (this.#lastFix && fix.t - this.#lastFix.t >= GAP_AFTER_MS) {
			d.gaps.push({
				at: Math.round(this.#lastFix.t / 1000),
				seconds: Math.round((fix.t - this.#lastFix.t) / 1000),
				metres: Math.round(metresBetween(this.#lastFix.at, fix.at)),
				hidden: this.#hiddenInGap || hidden,
				music: this.#musicInGap,
				reopened: this.#reopened
			});
			changed = true;
		}
		this.#lastFix = fix;
		this.#reopened = false;
		this.#hiddenInGap = hidden;
		this.#musicInGap = music.playing;
		d.fixes++;
		if (hidden) d.hiddenFixes++;
		if (music.playing) d.musicFixes++;

		const last = this.#points.at(-1) ?? null;
		if (this.#points.length < MAX_POINTS && worthWalking(last, fix, accuracy)) {
			const stored: StoredPoint | null = last
				? [last.at[0], last.at[1], Math.round(last.t / 1000)]
				: null;
			const { kept, distance } = addPoints(stored, [fix], FASTEST_WALK);
			if (kept.length) {
				this.#points.push(fix);
				this.distance += distance;
				changed = true;
			}
		}
		if (changed || Date.now() - this.#savedAt >= SAVE_EVERY_MS) this.#save();
	}

	#checkCue = () => {
		// Not said over a note being recorded: it waits until it ends.
		if (!this.recording || noteRecorder.recording) return;
		const seconds = (Date.now() - this.startedAt!) / 1000;
		const { text, cues } = dueCue(this.plan, this.#cues, this.distance, seconds);
		this.#cues = cues;
		if (!text) return;
		this.#save();
		this.#say(text);
	};

	/** With the device's own voice, without AI, over the music, which goes down meanwhile. */
	#say(text: string) {
		if (!('speechSynthesis' in window)) return;
		const utterance = new SpeechSynthesisUtterance(text);
		utterance.lang = 'es-ES';
		music.duck(true, 'paseo');
		const up = () => {
			clearTimeout(this.#duckTimer);
			music.duck(false, 'paseo');
		};
		clearTimeout(this.#duckTimer);
		this.#duckTimer = setTimeout(up, DUCK_AT_MOST_MS);
		utterance.onend = utterance.onerror = () => {
			if (!speechSynthesis.speaking) up();
		};
		speechSynthesis.speak(utterance);
	}

	/** How long the screen was off, once it is on again. */
	#countHidden() {
		if (this.#hiddenAt === null || document.hidden) return;
		this.#diagnosis.hiddenSeconds += Math.round((Date.now() - this.#hiddenAt) / 1000);
		this.#hiddenAt = null;
	}

	#onVisibility = () => {
		if (document.hidden) {
			this.#hiddenAt ??= Date.now();
			this.#hiddenInGap = true;
		} else {
			this.#countHidden();
			// The screen on again: if the browser let the watch die, it starts over.
			this.#watchGps();
		}
		this.#save();
	};

	#onLeave = () => this.#save();
}

export const walkRecorder = new WalkRecorder();
