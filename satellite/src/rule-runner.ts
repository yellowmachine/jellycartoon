import {
	ASKED_GAP_MIN,
	ASKED_PER_DAY,
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
 *
 * Phase 4: a rule `asked` it does not do by itself, only when Seilide asks («Satelite.Cumple»,
 * `asked`), which knows whether its conditions hold; and then only at its moment as the satellite
 * sees it: its time (the clock checked), or a cycle of that plug it read itself a few minutes ago;
 * a moment only Seilide knows, at most ASKED_PER_DAY times a day, ASKED_GAP_MIN apart. Each moment
 * once. So a Seilide broken into can only choose when, among those, never what nor where.
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
	/** The cycles read lately, by plug: for a rule Seilide asks for at one (phase 4). */
	const cycles = new Map<string, { moment: 'empieza' | 'termina'; at: number }[]>();

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

	/** Done now; what went wrong, if anything. Told to Seilide later unless it asked (it hears). */
	async function run(r: SatelliteRule, key: string, tell = true) {
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
		if (tell) {
			rules.queue({ id: r.id, key, at, ...(failed ? { failed } : {}) });
			void flush();
		}
		return failed;
	}

	/** Which moment of it Seilide's ask is for, now; or why it is not its moment. */
	function askedKey(r: SatelliteRule): string | { why: string } {
		const at = now();
		const w = r.when;
		if (w.kind === 'enchufe') {
			const seen = w.plugs
				.flatMap((p) => cycles.get(p) ?? [])
				.filter((c) => c.moment === w.moment && c.at >= at - LATE_MIN * 60_000)
				.sort((a, b) => b.at - a.at)[0];
			return seen ? `ciclo:${seen.at}` : { why: 'no ha visto ese ciclo' };
		}
		if (!clockOk()) return { why: 'no tiene la hora comprobada' };
		const here = localNow(at, timeZone);
		if (w.kind === 'seilide') {
			const today = rules
				.doneKeys(r.id)
				.filter((k) => k.startsWith(`pedida:${here.day} `))
				.map((k) => Number(k.slice(`pedida:${here.day} `.length)));
			if (today.length >= ASKED_PER_DAY)
				return { why: `ya la ha cumplido ${today.length} veces hoy` };
			if (today.some((m) => here.minutes - m < ASKED_GAP_MIN))
				return { why: `la cumplió hace menos de ${ASKED_GAP_MIN} minutos` };
			return `pedida:${here.day} ${here.minutes}`;
		}
		const day = w.kind === 'cada_dia' ? here.day : w.day;
		const late = here.minutes - minutesOf(w.time);
		if (day !== here.day || late < 0 || late > LATE_MIN) return { why: 'no es su hora' };
		return `${day} ${w.time}`;
	}

	/** The rules at a time: those whose moment is now, or a few minutes ago. */
	function tick() {
		const at = now();
		const here = localNow(at, timeZone);
		// Those Seilide asks for (phase 4): not by itself.
		const timed = rules
			.rules()
			.filter((r) => !r.asked && (r.when.kind === 'cada_dia' || r.when.kind === 'en_fecha'));
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
			const recent = (cycles.get(shellyId) ?? []).filter((c) => c.at >= at - LATE_MIN * 60_000);
			cycles.set(shellyId, [...recent, { moment, at }]);
			for (const r of rules.rules())
				if (
					!r.asked &&
					r.when.kind === 'enchufe' &&
					r.when.moment === moment &&
					r.when.plugs.includes(shellyId)
				)
					void run(r, `ciclo:${at}`);
		},
		/**
		 * Seilide asks for one of its rules now (phase 4), through that plug's connection: done if it
		 * is one to be asked for, of that plug, at its moment, and not done already. `ok: false`,
		 * refused, with why; else done, or what went wrong (its padlock, not connected…).
		 */
		async asked(
			shellyId: string,
			id: number
		): Promise<{ ok: false; why: string } | { ok: true; failed?: string }> {
			const r = rules.rules().find((r) => r.id === id);
			if (!r?.asked)
				return { ok: false, why: 'esa regla no está firmada para que la pida Seilide' };
			if (r.plug !== shellyId) return { ok: false, why: 'esa regla es de otro enchufe' };
			const key = askedKey(r);
			if (typeof key !== 'string') return { ok: false, why: key.why };
			if (rules.isDone(r.id, key)) return { ok: false, why: 'ya la ha cumplido' };
			const failed = await run(r, key, false);
			return failed ? { ok: true, failed } : { ok: true };
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
