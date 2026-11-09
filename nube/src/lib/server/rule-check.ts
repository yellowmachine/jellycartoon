import { addDays, dayName } from 'comun/agenda.ts';
import type { Occurrence } from 'comun/agenda.ts';
import { fold } from 'comun/music.ts';
import { isSnow, type HourAhead } from 'comun/weather.ts';
import type { PlannedLeg, PlannedTrip } from '#lib/planned-trips.ts';
import { hasWords } from '#lib/server/voice/learned.ts';
import { DOSE_LATE_MIN, type Condition, type RuleSpec, type WeatherCheck } from '#lib/rules.ts';

/**
 * Whether a rule (#331) holds, and why in words, looked at in a «world» (#389): the day and the
 * time it is, and where its sources are read from (the Agenda, the trips, the fridge, the memory,
 * Medicación, the weather, the meaning of what its words do not find). rules.ts gives it the real
 * one, now, and does what a rule says; rule-sim.ts gives it a moment to come, and only tells what
 * it would do. Nothing here writes or tells anything.
 */

/** A deduction feeds the next rule, at most this many in a row (#331, phase 4). */
export const MAX_CHAIN = 3;
/** A time missed (the server was off): still told this long after. */
export const LATE_MINUTES = 60;
/** An event of the whole day: looked at this time. */
const ALL_DAY_AT = '09:00';

export interface Rule {
	id: number;
	userId: string | null;
	said: string;
	understood: string;
	spec: RuleSpec;
	paused: boolean;
	lastFiredAt: Date | null;
	lastWhy: string | null;
	fired: string[];
	matches: Record<string, { ok: boolean; why: string }>;
}

/** A trip of a rule's person, with its first and last leg. */
export interface Trip {
	trip: PlannedTrip;
	first: PlannedLeg;
	last: PlannedLeg;
}

/** A dose of Medicación on a day: its time, its medicine, whose, and whether it is marked. */
export interface DoseOf {
	time: string;
	name: string;
	personId: string;
	who: string;
	taken: boolean;
}

/** What `fits` asks by meaning: the kind of thing, as the question puts it. */
export type Fitted = 'agenda' | 'nevera' | 'recuerdo' | 'compra';

export interface World {
	/** The wall's day and time it is looked at. */
	today: string;
	time: string;
	/**
	 * What is due by the clock in, as `minutesOf` (inclusive): now's last hour, as the clock looks
	 * every minute and tells one missed that long after; or the span simulated.
	 */
	from: number;
	to: number;
	/** A rule's person's trips (the house's: everyone's). */
	trips(r: Rule): Promise<Trip[]>;
	/** What the voice remembers for a rule's person (with the house's) that day. */
	memories(r: Rule): Promise<{ text: string; because?: string | null }[]>;
	/** The fridge's post-its and what is on the list, not done. */
	fridge(r: Rule): Promise<string[]>;
	agenda(r: Rule, from: string, to: string): Promise<Occurrence[]>;
	doses(r: Rule, day: string): Promise<DoseOf[]>;
	/** Where the family lives (Ajustes → «Dónde vivís»); null, not said. */
	home(r: Rule): Promise<{ lat: number; lon: number } | null>;
	/** The next hours' weather at a place, from `day` at `time`'s hour. */
	forecast(lat: number, lon: number, day: string, time: string): Promise<HourAhead[]>;
	/**
	 * Whether `text` is what `r` waits for, by its meaning, when its words do not find it: kept,
	 * or asked; null, not known (words only).
	 */
	meaning(r: Rule, kind: Fitted, text: string): Promise<{ ok: boolean; why: string } | null>;
	/**
	 * Several at once (a purchase's lines, #451), in one question; each answer as `meaning`'s, in
	 * their order. Unset: one by one, with `meaning`.
	 */
	meanings?(
		r: Rule,
		kind: Fitted,
		texts: string[]
	): Promise<({ ok: boolean; why: string } | null)[]>;
}

/** «Ana», «ana», «Ána», and «Ana» for Ana María: the same person. */
export const sameName = (full: string, said: string) => {
	const a = fold(full.trim());
	const b = fold(said.trim());
	return a === b || a.split(/\s+/)[0] === b;
};

export const quoted = (words: string[]) => words.map((w) => `«${w}»`).join(' y ');

/** How a meaning asked is kept in a rule's `matches`. */
export const matchKey = (kind: Fitted, text: string) =>
	`${kind}:${fold(text.trim()).slice(0, 200)}`;

/** `YYYY-MM-DD` and `HH:MM` as minutes, on the wall's clock: to compare and subtract. */
export const minutesOf = (day: string, time: string) => {
	const [y, m, d] = day.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	return Date.UTC(y!, m! - 1, d!, hh!, mm!) / 60_000;
};

/** Back from `minutesOf`: its day and its time. */
export const momentOf = (minutes: number) => {
	const iso = new Date(minutes * 60_000).toISOString();
	return { day: iso.slice(0, 10), time: iso.slice(11, 16) };
};

/**
 * Whether `text` is what `r` waits for with `words`: by its words; else by its meaning, as the
 * world knows it. `why`, to add to the notice's: «, que encaja con…».
 */
export async function fits(w: World, r: Rule, words: string[], kind: Fitted, text: string) {
	if (hasWords(words, text)) return { ok: true, why: '' };
	const kept = await w.meaning(r, kind, text);
	if (!kept) return { ok: false, why: '' };
	return {
		ok: kept.ok,
		why: kept.ok ? `, que encaja con ${quoted(words)}${kept.why ? ` (${kept.why})` : ''}` : ''
	};
}

/**
 * Which of `texts` `r` waits for with `words` (a purchase's lines, #451): by their words; the rest by
 * their meaning, all in one question if the world can. Those that fit, in their order.
 */
export async function fittingAll(
	w: World,
	r: Rule,
	words: string[],
	kind: Fitted,
	texts: string[]
) {
	const byWords = texts.map((t) => hasWords(words, t));
	const rest = texts.filter((_, i) => !byWords[i]);
	const asked = !rest.length
		? []
		: w.meanings
			? await w.meanings(r, kind, rest)
			: await Promise.all(rest.map((t) => w.meaning(r, kind, t)));
	let next = 0;
	return texts.filter((_, i) => byWords[i] || asked[next++]?.ok === true);
}

/** Its lines in a reason, at most this many: «CERV MAHOU, COCA COLA Z y 3 más». */
const SHOWN_ITEMS = 4;

/** «CERV MAHOU, COCA COLA Z», its tags off; with how many more. */
export function itemsSaid(items: string[]) {
	const names = items.map((i) => i.replace(/\s*\([^)]*\)$/, ''));
	const shown = names.slice(0, SHOWN_ITEMS).join(', ');
	return names.length > SHOWN_ITEMS ? `${shown} y ${names.length - SHOWN_ITEMS} más` : shown;
}

/** Why, for a purchase: «han comprado en Mercadona: CERV MAHOU, COCA COLA Z». */
export const boughtWhy = (store: string, items: string[]) =>
	`han comprado${store.trim() ? ` en ${store.trim()}` : ''}: ${itemsSaid(items)}`;

/** The first of `items` that fits, with why; null if none. */
async function firstFitting<T>(
	w: World,
	r: Rule,
	words: string[],
	kind: Fitted,
	items: T[],
	textOf: (item: T) => string
) {
	for (const item of items) {
		const fit = await fits(w, r, words, kind, textOf(item));
		if (fit.ok) return { item, why: fit.why };
	}
	return null;
}

/**
 * Whether something of `ownerId`'s (null: the house's) that happened is for `r`: a post-it or a
 * purchase (the family's, as Gastos), for every rule; something said, for its person's and the house's; something remembered, a person's
 * for theirs, the house's for all.
 */
export const waitsFor = (
	r: Rule,
	kind: 'nevera' | 'recuerdo' | 'dicho' | 'compra',
	ownerId: string | null
) =>
	kind === 'nevera' ||
	kind === 'compra' ||
	(kind === 'dicho' ? !r.userId || r.userId === ownerId : !ownerId || r.userId === ownerId);

/** Its person's trip that day, if any. */
export const awayOn = (trips: Trip[], day: string) =>
	trips.find((t) => t.first.day <= day && day <= t.last.day);

/** A condition: whether it holds (negated already), and why in words. */
async function holds(w: World, r: Rule, c: Condition): Promise<{ ok: boolean; why: string }> {
	const today = w.today;
	const mine = Boolean(r.userId);
	let found: string | null = null;
	let none = '';
	switch (c.kind) {
		case 'de_viaje': {
			const away = awayOn(await w.trips(r), today);
			found = away ? `${mine ? 'estás' : 'alguien está'} de viaje («${away.trip.name}»)` : null;
			none = mine ? 'no estás de viaje' : 'nadie está de viaje';
			break;
		}
		case 'recuerdo': {
			const m = await firstFitting(w, r, c.words, 'recuerdo', await w.memories(r), (m) => m.text);
			found = m
				? `recuerdo «${m.item.text}»${m.why}${m.item.because ? ` (${m.item.because})` : ''}`
				: null;
			none = `no recuerdo nada con ${quoted(c.words)}`;
			break;
		}
		case 'nevera': {
			const t = await firstFitting(w, r, c.words, 'nevera', await w.fridge(r), (t) => t);
			found = t ? `en la nevera pone «${t.item}»${t.why}` : null;
			none = `no hay nada en la nevera con ${quoted(c.words)}`;
			break;
		}
		case 'tiempo': {
			if (!c.weather) break;
			const weather = await weatherFor(w, r, c.weather);
			found = weather.hit;
			none = weather.none;
			break;
		}
		case 'agenda_hoy': {
			const o = await firstFitting(
				w,
				r,
				c.words,
				'agenda',
				(await w.agenda(r, today, today)).filter((o) => o.day <= today && today <= o.lastDay),
				(o) => o.title
			);
			found = o ? `hoy hay «${o.item.title}» en la Agenda${o.why}` : null;
			none = `hoy no hay nada en la Agenda con ${quoted(c.words)}`;
			break;
		}
	}
	const ok = c.negate ? !found : Boolean(found);
	return { ok, why: found ?? none };
}

/** All of its conditions: whether they hold, and why. */
export async function conditionsHold(w: World, r: Rule) {
	const checked = [];
	for (const c of r.spec.conditions) checked.push(await holds(w, r, c));
	return { ok: checked.every((c) => c.ok), why: checked.map((c) => c.why) };
}

/**
 * Where a rule's weather is looked at: at home, or, `donde_este` and its person on a trip that
 * day, where they arrived last. Null if the family has not said where it lives.
 */
async function placeFor(w: World, r: Rule, where: WeatherCheck['where']) {
	if (where === 'donde_este') {
		const leg = awayOn(await w.trips(r), w.today)
			?.trip.legs.filter((l) => l.day <= w.today)
			.at(-1);
		if (leg) return { lat: leg.end[1], lon: leg.end[0], at: `en ${leg.to}` };
	}
	const home = await w.home(r);
	return home && { lat: home.lat, lon: home.lon, at: 'en casa' };
}

const hourOf = (h: HourAhead) => `a las ${h.at.slice(11, 16)}`;
const COMES = {
	lluvia: (h: HourAhead) => `va a llover (${h.rain} % ${hourOf(h)})`,
	helada: (h: HourAhead) => `va a helar (${h.temperature} °C ${hourOf(h)})`,
	calor: (h: HourAhead) => `va a hacer calor (${h.temperature} °C ${hourOf(h)})`,
	viento: (h: HourAhead) => `va a hacer viento (${h.wind} km/h ${hourOf(h)})`,
	nieve: (h: HourAhead) => `va a nevar (${hourOf(h)})`
};
const NOT_COMING = {
	lluvia: 'no va a llover',
	helada: 'no va a helar',
	calor: 'no va a hacer calor',
	viento: 'no va a hacer viento',
	nieve: 'no va a nevar'
};

/** The weather it waits for, in its next hours: the hour it comes (in words), or why not. */
export async function weatherFor(w: World, r: Rule, check: WeatherCheck) {
	const place = await placeFor(w, r, check.where);
	if (!place) return { hit: null, none: 'no sé dónde vivís (Ajustes → «Dónde vivís»)' };
	let hours: HourAhead[];
	try {
		hours = (await w.forecast(place.lat, place.lon, w.today, w.time)).slice(0, check.hours);
	} catch (error) {
		return {
			hit: null,
			none: `no sé el tiempo (${error instanceof Error ? error.message : error})`
		};
	}
	const comes = hours.find((h) =>
		check.what === 'lluvia'
			? h.rain >= check.threshold
			: check.what === 'helada'
				? h.temperature <= check.threshold
				: check.what === 'calor'
					? h.temperature >= check.threshold
					: check.what === 'viento'
						? h.wind >= check.threshold
						: isSnow(h.code)
	);
	return {
		hit: comes ? `${COMES[check.what](comes)} ${place.at}` : null,
		none: `${NOT_COMING[check.what]} ${place.at} en las próximas ${check.hours} h`
	};
}

/** What a rule waits for by the clock, due in the world's span: when, its key and why. */
export interface Due {
	at: number;
	key: string;
	why: string;
}

/** What it waits for by the clock (not the weather), due in the world's span: each with its key and why. */
export async function dueIn(w: World, r: Rule): Promise<Due[]> {
	const today = w.today;
	const atOf = (day: string, time: string) => minutesOf(day, time) - r.spec.when.minutesBefore;
	const due = (at: number) => w.from <= at && at <= w.to;
	const { when } = r.spec;
	const found: Due[] = [];
	if (when.kind === 'cada_dia' && when.time) {
		const at = atOf(today, when.time);
		if (due(at)) found.push({ at, key: `cada_dia:${today}`, why: `son las ${when.time}` });
	}
	if (when.kind === 'agenda') {
		const ahead = Math.ceil(when.minutesBefore / (24 * 60)) + 1;
		for (const o of await w.agenda(r, today, addDays(today, ahead))) {
			const at = atOf(o.day, o.startTime ?? ALL_DAY_AT);
			// Its time first: only then, if its words do not say, asked by its meaning.
			if (!due(at)) continue;
			const fit = await fits(w, r, when.words, 'agenda', o.title);
			if (fit.ok)
				found.push({
					at,
					key: `agenda:${o.eventId}:${o.day}`,
					why: `${when.minutesBefore ? 'va a empezar' : 'empieza'} «${o.title}» (${dayName(o.day)}${o.startTime ? `, ${o.startTime}` : ''})${fit.why}`
				});
		}
	}
	if (when.kind === 'viaje_empieza' || when.kind === 'viaje_acaba')
		for (const { trip, first, last } of await w.trips(r)) {
			const leg = when.kind === 'viaje_empieza' ? first : last;
			if (when.kind === 'viaje_acaba' && first === last) continue;
			const at = atOf(leg.day, leg.time);
			if (due(at))
				found.push({
					at,
					key: `${when.kind}:${trip.id}:${leg.day}`,
					why: `${when.kind === 'viaje_empieza' ? 'empieza' : 'acaba'} el viaje «${trip.name}»`
				});
		}
	if (when.kind === 'toma_sin_marcar') found.push(...(await dosesLate(w, r)));
	return found.sort((a, b) => a.at - b.at);
}

/**
 * Doses still not marked `minutesAfter` their time (Medicación, #308), of the people it names
 * (none: anyone's): a person's at the same time, together.
 */
async function dosesLate(w: World, r: Rule): Promise<Due[]> {
	const today = w.today;
	const after = r.spec.when.minutesAfter ?? DOSE_LATE_MIN;
	const late = (await w.doses(r, today)).filter((d) => {
		const at = minutesOf(today, d.time) + after;
		return (
			!d.taken &&
			w.from <= at &&
			at <= w.to &&
			(!r.spec.when.words.length || r.spec.when.words.some((word) => sameName(d.who, word)))
		);
	});
	const groups = new Map<string, DoseOf[]>();
	for (const d of late)
		groups.set(`${d.personId}:${d.time}`, [...(groups.get(`${d.personId}:${d.time}`) ?? []), d]);
	return [...groups].map(([key, doses]) => ({
		at: minutesOf(today, doses[0]!.time) + after,
		key: `toma:${key}:${today}`,
		why: `la toma de las ${doses[0]!.time} de ${doses[0]!.who || 'alguien'} (${doses.map((d) => d.name).join(', ')}) sigue sin marcar`
	}));
}
