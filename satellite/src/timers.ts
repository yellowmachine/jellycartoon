import { describeTimers, sameLabel, timeLabel, type DoneTimer } from '../../src/lib/timer-names.ts';

/**
 * The satellite's timers (#223), as the phone's (timers.svelte.ts): set by voice, each with its name,
 * prepared ones waiting for something, and told to the AI with each order. Kept in a file of its
 * own volume (`TIMERS_FILE`), so that a restart does not lose them. How they ring is main.ts's.
 */

export interface Timer {
	/** As the AI wrote it: «la pasta», «pedir cita en la peluquería»; its time if none. */
	label: string;
	/** When it ends, in ms (Date.now()). */
	endsAt: number;
}

export interface PreparedTimer {
	label: string;
	seconds: number;
	/** What it waits for: «hierva el agua». */
	trigger: string;
}

interface Saved {
	running: Timer[];
	prepared: PreparedTimer[];
}

/** As the phone's: how long one that rang or was taken away is still told to the AI. */
const RECENT_MS = 30 * 60_000;
/** What the AI may still call one with no name: as if it had none. */
const DEFAULT_LABEL = 'temporizador';

export class Timers {
	running: Timer[] = [];
	prepared: PreparedTimer[] = [];
	/** Those that got to their end and were not stopped yet. */
	ringing: Timer[] = [];
	#done: DoneTimer[] = [];

	constructor(
		private save: (saved: Saved) => void,
		private now = () => Date.now()
	) {}

	/** As saved; those that ended meanwhile, ringing with the next `due()`. */
	load(saved: unknown) {
		const s = saved as Partial<Saved> | null;
		this.running = (Array.isArray(s?.running) ? s.running : []).filter(
			(t): t is Timer => typeof t?.label === 'string' && Number.isFinite(t.endsAt)
		);
		this.prepared = (Array.isArray(s?.prepared) ? s.prepared : []).filter(
			(t): t is PreparedTimer =>
				typeof t?.label === 'string' && typeof t.trigger === 'string' && Number.isFinite(t.seconds)
		);
	}

	/** One with the same name starts over; a prepared one with that name is the one starting. */
	start(label: string, seconds: number) {
		label = this.#name(label, seconds);
		const gone = (t: { label: string }) => !sameLabel(t.label, label);
		this.running = [...this.running.filter(gone), { label, endsAt: this.now() + seconds * 1000 }];
		this.ringing = this.ringing.filter(gone);
		this.prepared = this.prepared.filter(gone);
		this.#store();
		return label;
	}

	prepare(label: string, seconds: number, trigger: string) {
		label = this.#name(label, seconds);
		this.prepared = [
			...this.prepared.filter((t) => !sameLabel(t.label, label)),
			{ label, seconds, trigger: trigger.trim() }
		];
		this.#store();
		return label;
	}

	/** That one (by its name), or all of them with null; how many went. */
	cancel(label: string | null) {
		const gone = (t: { label: string }) => label === null || sameLabel(t.label, label);
		const count =
			this.running.filter(gone).length +
			this.ringing.filter(gone).length +
			this.prepared.filter(gone).length;
		this.#remember([...this.running, ...this.prepared].filter(gone), 'quitado');
		this.#remember(this.ringing.filter(gone), 'sonó');
		this.running = this.running.filter((t) => !gone(t));
		this.ringing = this.ringing.filter((t) => !gone(t));
		this.prepared = this.prepared.filter((t) => !gone(t));
		this.#store();
		return count;
	}

	/** «Hola casita» while they ring: they stop. */
	silence() {
		this.#remember(this.ringing, 'sonó');
		this.ringing = [];
	}

	/** Those that just got to their end, now ringing. */
	due() {
		const now = this.now();
		const ended = this.running.filter((t) => t.endsAt <= now);
		if (!ended.length) return [];
		this.running = this.running.filter((t) => t.endsAt > now);
		this.ringing = [...this.ringing, ...ended];
		this.#store();
		return ended;
	}

	describe() {
		const now = this.now();
		const all = [...this.running, ...this.ringing, ...this.prepared];
		const done = this.#done.filter(
			(d) => now - d.at < RECENT_MS && !all.some((t) => sameLabel(t.label, d.label))
		);
		return describeTimers(
			{ done, running: this.running, ringing: this.ringing, prepared: this.prepared },
			now
		);
	}

	/** As the phone's: without a name, its time, and «5 minutos (2)» if that one is taken. */
	#name(label: string, seconds: number) {
		label = label.trim();
		if (label && !sameLabel(label, DEFAULT_LABEL)) return label;
		const base = timeLabel(seconds);
		const taken = (name: string) =>
			[...this.running, ...this.ringing, ...this.prepared].some((t) => sameLabel(t.label, name));
		let name = base;
		for (let n = 2; taken(name); n++) name = `${base} (${n})`;
		return name;
	}

	#remember(gone: { label: string }[], how: DoneTimer['how']) {
		const at = this.now();
		this.#done = [
			...this.#done.filter(
				(d) => at - d.at < RECENT_MS && !gone.some((g) => sameLabel(g.label, d.label))
			),
			...gone.map((g) => ({ label: g.label, how, at }))
		];
	}

	#store() {
		this.save({ running: this.running, prepared: this.prepared });
	}
}
