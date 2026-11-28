/**
 * The plug rules a satellite keeps (#651): those it can look at by itself, without Seilide nor the
 * internet. Seilide writes them from the family's rules (nube's plugs/satellite-rules.ts); a device
 * given to the satellite signs the whole list (`Satelite.Reglas`), or, said to the satellite itself,
 * it takes them unsigned right after it heard an order (satellite/src/rules.ts). Only by plug ids
 * (the Shelly's own), times and on or off: nothing the AI understood, nothing to read aloud.
 *
 * Used by the satellite too: no other comun imports here (satellite/Dockerfile copies it alone).
 */

/** A rule switches a plug for at most this long: a misunderstood one is a heater on all day. */
export const MAX_PLUG_MIN = 4 * 60;
/** More than this many, it is not a family's list. */
export const MAX_SATELLITE_RULES = 100;
/** A rule said to the satellite is taken unsigned only this long after it heard an order. */
export const VOICE_RULES_MS = 2 * 60_000;
/**
 * A rule whose moment only Seilide knows (#651, phase 4: the weather, arriving home…): done when
 * Seilide asks, at most this many times a day, and at least this long apart.
 */
export const ASKED_PER_DAY = 4;
export const ASKED_GAP_MIN = 30;

/**
 * When: every day at a time, one day at a time, or a plug's cycle that starts or ends; or (#651,
 * phase 4) a moment only Seilide knows (`seilide`, always `asked`).
 */
export type SatelliteWhen =
	| { kind: 'cada_dia'; time: string }
	| { kind: 'en_fecha'; day: string; time: string }
	| { kind: 'enchufe'; plugs: string[]; moment: 'empieza' | 'termina' }
	| { kind: 'seilide' };

export interface SatelliteRule {
	/** Its id in Seilide: what it did is told back by it. */
	id: number;
	when: SatelliteWhen;
	/** The plug it switches (its Shelly id), on or off, and for how long (null, it stays so). */
	plug: string;
	on: boolean;
	minutes: number | null;
	/** Done once, and then not again (an errand). */
	once: boolean;
	/**
	 * Done only when Seilide asks (#651, phase 4: «cumple la regla N»), because only Seilide knows
	 * whether its conditions hold, or its moment: and then only at its moment as the satellite sees
	 * it (its time, a cycle it read itself), or, for a moment only Seilide knows, a few times a day.
	 * What it does, on which plug and for how long, is still what was signed.
	 */
	asked?: true;
}

/** The list, as signed: for which satellite (its fingerprint), and its version, which only goes up. */
export interface SatelliteRules {
	version: number;
	rules: SatelliteRule[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const SHELLY = /^shelly[\w-]{1,80}$/i;

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);
const onlyKeys = (v: Record<string, unknown>, keys: string[]) =>
	Object.keys(v).every((k) => keys.includes(k));

export const isShellyId = (v: unknown): v is string => typeof v === 'string' && SHELLY.test(v);

function validWhen(w: unknown): w is SatelliteWhen {
	if (!isObject(w)) return false;
	if (w.kind === 'cada_dia')
		return onlyKeys(w, ['kind', 'time']) && typeof w.time === 'string' && TIME.test(w.time);
	if (w.kind === 'en_fecha')
		return (
			onlyKeys(w, ['kind', 'day', 'time']) &&
			typeof w.day === 'string' &&
			DAY.test(w.day) &&
			typeof w.time === 'string' &&
			TIME.test(w.time)
		);
	if (w.kind === 'enchufe')
		return (
			onlyKeys(w, ['kind', 'plugs', 'moment']) &&
			(w.moment === 'empieza' || w.moment === 'termina') &&
			Array.isArray(w.plugs) &&
			w.plugs.length >= 1 &&
			w.plugs.length <= 20 &&
			w.plugs.every(isShellyId)
		);
	if (w.kind === 'seilide') return onlyKeys(w, ['kind']);
	return false;
}

/** One rule, exactly as it has to be: anything else in it, and it is not taken. */
export function validRule(r: unknown): r is SatelliteRule {
	return (
		isObject(r) &&
		onlyKeys(r, ['id', 'when', 'plug', 'on', 'minutes', 'once', 'asked']) &&
		(r.asked === undefined || r.asked === true) &&
		// A moment only Seilide knows: only when it asks.
		(r.asked === true || (isObject(r.when) && r.when.kind !== 'seilide')) &&
		Number.isSafeInteger(r.id) &&
		(r.id as number) > 0 &&
		validWhen(r.when) &&
		isShellyId(r.plug) &&
		typeof r.on === 'boolean' &&
		(r.minutes === null ||
			(Number.isInteger(r.minutes) &&
				(r.minutes as number) > 0 &&
				(r.minutes as number) <= MAX_PLUG_MIN)) &&
		typeof r.once === 'boolean'
	);
}

/** The whole list, checked: each rule, once by its id; its version, a positive integer. */
export function validRules(v: unknown): v is SatelliteRules {
	if (!isObject(v) || !onlyKeys(v, ['version', 'rules'])) return false;
	if (!Number.isSafeInteger(v.version) || (v.version as number) < 1) return false;
	if (!Array.isArray(v.rules) || v.rules.length > MAX_SATELLITE_RULES) return false;
	const ids = new Set<number>();
	for (const r of v.rules) {
		if (!validRule(r) || ids.has(r.id)) return false;
		ids.add(r.id);
	}
	return true;
}

/** The same rule: what it does and when, whatever the order of its keys. */
export const sameRule = (a: SatelliteRule, b: SatelliteRule) =>
	JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** Its keys always in one order, and its plugs sorted: two lists made apart compare equal. */
export function canonical(r: SatelliteRule): SatelliteRule {
	const when: SatelliteWhen =
		r.when.kind === 'cada_dia'
			? { kind: 'cada_dia', time: r.when.time }
			: r.when.kind === 'en_fecha'
				? { kind: 'en_fecha', day: r.when.day, time: r.when.time }
				: r.when.kind === 'enchufe'
					? { kind: 'enchufe', plugs: [...r.when.plugs].sort(), moment: r.when.moment }
					: { kind: 'seilide' };
	return {
		id: r.id,
		when,
		plug: r.plug,
		on: r.on,
		minutes: r.minutes,
		once: r.once,
		// Only when so: a list signed before it means the same.
		...(r.asked ? { asked: true as const } : {})
	};
}

/** The list sorted by id, each rule canonical: what is compared, and what is signed. */
export const canonicalRules = (rules: SatelliteRule[]) =>
	[...rules].sort((a, b) => a.id - b.id).map(canonical);

/** The same rules, by what each does. */
export function sameRules(a: SatelliteRule[], b: SatelliteRule[]) {
	return JSON.stringify(canonicalRules(a)) === JSON.stringify(canonicalRules(b));
}

/**
 * Said to the satellite (#651): a new list taken without a device's signature only if each rule it
 * had is still there, as it was, or gone; and those new are only for its own plugs. So a Seilide
 * that is broken into cannot change a signed rule into another one, nor switch a plug of elsewhere.
 */
export function voiceChangeOk(
	before: SatelliteRule[],
	after: SatelliteRule[],
	ownPlug: (shellyId: string) => boolean
) {
	const had = new Map(before.map((r) => [r.id, r]));
	for (const r of after) {
		const old = had.get(r.id);
		if (old ? !sameRule(old, r) : !plugsOf(r).every(ownPlug)) return false;
	}
	return true;
}

/** The plugs a rule touches: the one it switches, and those it watches. */
export const plugsOf = (r: SatelliteRule) =>
	r.when.kind === 'enchufe' ? [r.plug, ...r.when.plugs] : [r.plug];

/**
 * What stops a plug's rule (#651, phase 3), as Seilide's switchIn: its padlock, its pause, or its
 * long heat (then no timer). Sent unsigned: it can only make the satellite do less.
 */
export interface PlugGuard {
	locked: boolean;
	paused: boolean;
	/** Its long heat goes on until then, in ms; null, none. */
	heatUntil: number | null;
	/**
	 * «Esta tarde no» (#557), from and until, in ms (#651, phase 5): its schedules do not switch it
	 * on then. Unsigned, as the pause: on the plug's own schedules it only keeps them from switching
	 * it on (`planJobs`).
	 */
	skipFrom?: number | null;
	skipUntil?: number | null;
}

export function validGuards(v: unknown): v is Record<string, PlugGuard> {
	if (!isObject(v) || Object.keys(v).length > 200) return false;
	return Object.entries(v).every(
		([id, g]) =>
			isShellyId(id) &&
			isObject(g) &&
			typeof g.locked === 'boolean' &&
			typeof g.paused === 'boolean' &&
			(g.heatUntil === null || Number.isFinite(g.heatUntil))
	);
}

/** Why a rule cannot switch it now, as Seilide says it (rules.ts, switchFor); null, it can. */
export function guardWhy(g: PlugGuard | undefined, minutes: number | null, now: number) {
	if (!g) return null;
	if (g.locked) return 'tiene el candado puesto';
	if (g.paused) return 'está en pausa';
	if (minutes && g.heatUntil !== null && g.heatUntil > now)
		return 'está calentando largo tras la pausa';
	return null;
}

/** What a satellite tells Seilide it did with a rule (#651): done, or why not. */
export interface RuleDone {
	id: number;
	/** Which time it was: «2026-11-28 22:00», or a cycle's «ciclo:<ms>». Once each. */
	key: string;
	at: number;
	/** Why not; none, done. */
	failed?: string;
	/** Its moment went by without the satellite doing it (a restart, no clock). */
	missed?: boolean;
}

/**
 * A plug's schedules as signed (#651, phase 5: `Satelite.Horarios` with a `plan`): its jobs as they
 * are on a normal day, and what changes them for a while, with its end: paused, its long heat
 * (none of its jobs until then), «esta tarde no» (not its «on» ones then). The satellite keeps it
 * and puts them back itself when each ends, also without the internet.
 */
export interface PlugPlan {
	paused: boolean;
	heatUntil: number | null;
	skipFrom: number | null;
	skipUntil: number | null;
}

export interface PlanJob {
	timespec: string;
	on: boolean;
	enable: boolean;
}

/** A heat is a few hours, a skip a couple of weeks: further, it is not a plan. */
const MAX_HEAT_MS = 86_400_000;
const MAX_SKIP_MS = 15 * 86_400_000;

const msOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));

/** A plan as it has to be, by the satellite's clock now. */
export function validPlan(v: unknown, now: number): v is PlugPlan {
	if (!isObject(v) || !onlyKeys(v, ['paused', 'heatUntil', 'skipFrom', 'skipUntil'])) return false;
	if (typeof v.paused !== 'boolean') return false;
	if (!msOrNull(v.heatUntil) || !msOrNull(v.skipFrom) || !msOrNull(v.skipUntil)) return false;
	if (v.heatUntil !== null && (v.heatUntil as number) > now + MAX_HEAT_MS) return false;
	if ((v.skipFrom === null) !== (v.skipUntil === null)) return false;
	if (
		v.skipFrom !== null &&
		((v.skipUntil as number) <= (v.skipFrom as number) ||
			(v.skipUntil as number) > now + MAX_SKIP_MS)
	)
		return false;
	return true;
}

const inside = (from: number | null | undefined, until: number | null | undefined, now: number) =>
	from != null && until != null && from <= now && now < until;

/**
 * Its jobs now, as Seilide's jobsFor: none while paused or heating, not the «on» ones in a skip.
 * What Seilide says unsigned (`guard`: a pause, a skip said to it) only keeps the «on» ones off:
 * never switching it, nor leaving it on.
 */
export function planJobs(
	base: PlanJob[],
	plan: PlugPlan,
	guard: PlugGuard | undefined,
	now: number
): PlanJob[] {
	const enable = !plan.paused && !(plan.heatUntil !== null && plan.heatUntil > now);
	const noOn =
		inside(plan.skipFrom, plan.skipUntil, now) ||
		guard?.paused === true ||
		inside(guard?.skipFrom, guard?.skipUntil, now);
	return base.map((j) => ({ ...j, enable: j.enable && enable && !(j.on && noOn) }));
}
