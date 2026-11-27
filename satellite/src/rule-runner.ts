import {
	guardWhy,
	type RuleDone,
	type SatelliteRule
} from '../../packages/comun/src/plug-rules.ts';
import type { CycleEvent } from '../../packages/comun/src/plug-watch.ts';
import type { Rules } from './rules.ts';

/**
 * The satellite does its plug rules itself (#651, phase 3), also without the internet: those at a
 * time, by its own clock (`TZ`), only once it has been checked against Seilide's since it started
 * (a Pi has no clock with a battery: after a power cut without internet it would start at the time
 * it went off); and those of a cycle, as its relay reads the watts, which need no clock. Each time
 * once, kept across restarts; a time missed by more than LATE_MIN is let go (an errand, told so).
 * What it did, or why not (the plug's padlock, pause, not connected), is told to Seilide, kept until
 * it is.
 */

/** Its moment gone by less than this (a restart, the clock just checked): still done. */
export const LATE_MIN = 5;
/** How often the clock is looked at. */
export const TICK_MS = 15_000;

export interface RunnerOptions {
	rules: Rules;
	switchPlug: (shellyId: string, on: boolean, minutes: number | null) => Promise<void>;
	/** Its clock checked against Seilide's since it started. */
	clockOk: () => boolean;
	/** Tells Seilide; throws if it could not. */
	send: (done: RuleDone[]) => Promise<void>;
	log: (message: string) => void;
	now?: () => number;
	/** Its time zone; none, the process's (`TZ`). */
	timeZone?: string;
}

/** «2026-11-28» and minutes since midnight, as its clock says in its zone. */
export function localNow(at: number, timeZone?: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(at)
			.map((p) => [p.type, p.value])
	);
	return {
		day: `${parts.year}-${parts.month}-${parts.day}`,
		minutes: Number(parts.hour) * 60 + Number(parts.minute)
	};
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

export function createRunner({
	rules,
	switchPlug,
	clockOk,
	send,
	log,
	now = Date.now,
	timeZone
}: RunnerOptions) {
	let sending = false;

	async function flush() {
		if (sending) return;
		const box = rules.outbox();
		if (!box.length) return;
		sending = true;
		try {
			await send(box);
			rules.sent(box.length);
		} catch {
			// Kept: told when Seilide is back.
		} finally {
			sending = false;
		}
	}

	async function run(r: SatelliteRule, key: string) {
		// Kept first: a restart in the middle never does it twice.
		rules.markDone(r.id, key);
		const at = now();
		let failed = guardWhy(rules.guard(r.plug), r.minutes, at) ?? undefined;
		if (!failed)
			try {
				await switchPlug(r.plug, r.on, r.minutes);
			} catch (err) {
				failed = err instanceof Error ? err.message : String(err);
			}
		log(
			`Regla ${r.id}: ${r.on ? 'enciende' : 'apaga'} ${r.plug}${failed ? `, no ha podido: ${failed}` : ''}`
		);
		rules.queue({ id: r.id, key, at, ...(failed ? { failed } : {}) });
		void flush();
	}

	/** The rules at a time: those whose moment is now, or a few minutes ago. */
	function tick() {
		const at = now();
		const here = localNow(at, timeZone);
		const timed = rules.rules().filter((r) => r.when.kind !== 'enchufe');
		if (timed.length && !clockOk()) return;
		for (const r of timed) {
			const w = r.when as Extract<SatelliteRule['when'], { time: string }>;
			const day = w.kind === 'cada_dia' ? here.day : (w as { day: string }).day;
			const key = `${day} ${w.time}`;
			if (rules.isDone(r.id, key)) continue;
			const late =
				day < here.day ? Infinity : day > here.day ? -1 : here.minutes - minutesOf(w.time);
			if (late < 0) continue;
			if (late <= LATE_MIN) {
				void run(r, key);
				continue;
			}
			// Gone by: an errand is told so (Seilide pauses it with why); every day's, tomorrow again.
			rules.markDone(r.id, key);
			if (r.once) {
				rules.queue({ id: r.id, key, at, missed: true });
				void flush();
			}
		}
	}

	return {
		tick,
		flush,
		/** A plug's cycle started or ended (relay.ts): its rules done now. */
		cycle(shellyId: string, event: CycleEvent) {
			const moment = event === 'started' ? 'empieza' : 'termina';
			const at = now();
			for (const r of rules.rules())
				if (
					r.when.kind === 'enchufe' &&
					r.when.moment === moment &&
					r.when.plugs.includes(shellyId)
				)
					void run(r, `ciclo:${at}`);
		},
		start() {
			const timer = setInterval(() => {
				tick();
				void flush();
			}, TICK_MS);
			timer.unref?.();
			return () => clearInterval(timer);
		}
	};
}
