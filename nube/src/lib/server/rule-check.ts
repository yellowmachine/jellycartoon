import { addDays, dayName } from 'comun/agenda.ts';
import type { Occurrence } from 'comun/agenda.ts';
import { fold } from 'comun/music.ts';
import { isSnow, type HourAhead } from 'comun/weather.ts';
import type { PlannedLeg, PlannedTrip } from '#lib/planned-trips.ts';
import { hasWords } from '#lib/server/voice/learned.ts';
import {
	DOSE_LATE_MIN,
	type Condition,
	type PlaceMoment,
	type PlugMoment,
	type RuleSpec,
	type SolarCheck,
	type TemperatureCheck,
	type WeatherCheck
} from '#lib/rules.ts';
import type { SolarDay } from '#lib/solar.ts';

/**
 * Whether a rule (#331) holds, and why in words, looked at in a «world» (#389): the day and the
 * time it is, and where its sources are read from (the Agenda, the trips, the fridge, the memory,
 * Medicación, the weather, the meaning of what its words do not find). rules.ts gives it the real
 * one, now, and does what a rule says; rule-sim.ts gives it a moment to come, and only tells what
 * it would do. Nothing here writes or tells anything.
 */

/**
 * A sensor's reading counts this long (#557): older, the temperature now is not known (a battery H&T
 * wakes every 2 hours, or when it changes).
 */
export const SENSOR_FRESH_MIN = 3 * 60;

/** A temperature sensor (#508) as a rule looks at it: its last reading, and how long ago. */
export interface SensorNow {
	id: string;
	name: string;
	/** The one of «la casa»: marked, or the only one. */
	home: boolean;
	tempC: number | null;
	/** Minutes since its last reading; null, never read. */
	ageMin: number | null;
}

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
	 * What the family's solar panels will do, day by day from today (Energía → Previsión); null,
	 * no panels or no forecast (with why). Unset: not known.
	 */
	solar?(r: Rule): Promise<SolarDay[] | string | null>;
	/** The family's temperature sensors, as they read now (#557). Unset: not known. */
	sensors?(r: Rule): Promise<SensorNow[]>;
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
	kind: 'nevera' | 'recuerdo' | 'dicho' | 'compra' | 'cita_hecha',
	ownerId: string | null
) =>
	kind === 'nevera' ||
	kind === 'compra' ||
	kind === 'cita_hecha' ||
	(kind === 'dicho' ? !r.userId || r.userId === ownerId : !ownerId || r.userId === ownerId);

/** A plug's cycle that started or ended (#528): which plug, its name and kind, and when. */
export interface PlugHappened {
	plugId: string;
	/** Its name and its kind's («Bosch» · «Lavadora»): what the rule's words are looked for in. */
	name: string;
	kindLabel: string;
	moment: PlugMoment;
}

/** Whether a rule waits for this plug's moment: its moment (unset, «termina»), and its words. */
export const plugFits = (r: Rule, p: PlugHappened) =>
	r.spec.when.kind === 'enchufe' &&
	(r.spec.when.plug ?? 'termina') === p.moment &&
	hasWords(r.spec.when.words, `${p.name} ${p.kindLabel}`);

/** ««Lavadora» ha terminado a las 10:05». */
export const plugWhy = (p: PlugHappened, time: string) =>
	`«${p.name}» ha ${p.moment === 'empieza' ? 'empezado' : 'terminado'} a las ${time}`;

/**
 * Arriving at or leaving a place (#593), as OwnTracks on a person's phone told it: whose, the
 * place's name («Casa»), and which.
 */
export interface PlaceHappened {
	userId: string;
	name: string;
	moment: PlaceMoment;
}

/**
 * Whether a rule waits for this: only the person's own rules (a house's rule, or another
 * person's, never learns where one is), its moment (unset, «llega»), and its words in the name.
 */
export const placeFits = (r: Rule, p: PlaceHappened) =>
	r.spec.when.kind === 'lugar' &&
	r.userId === p.userId &&
	(r.spec.when.place ?? 'llega') === p.moment &&
	hasWords(r.spec.when.words, p.name);

/** «has llegado a «Casa» a las 19:42». */
export const placeWhy = (p: PlaceHappened, time: string) =>
	`has ${p.moment === 'llega' ? 'llegado a' : 'salido de'} «${p.name}» a las ${time}`;

/** An event of the Agenda marked as done (#600): which repetition, and by whom. */
export interface DoneEvent {
	eventId: number;
	title: string;
	day: string;
	userId: string;
}

/** In `fired`: that repetition, once. */
export const doneKey = (d: Pick<DoneEvent, 'eventId' | 'day'>) =>
	`cita_hecha:${d.eventId}:${d.day}`;

/** Its person's trip that day, if any. */
export const awayOn = (trips: Trip[], day: string) =>
	trips.find((t) => t.first.day <= day && day <= t.last.day);

/**
 * A condition: whether it holds (negated already), and why in words; `unknown`, what it needs is not
 * known now (a sensor's temperature with no recent reading), so it does not hold either way.
 */
async function holds(
	w: World,
	r: Rule,
	c: Condition
): Promise<{ ok: boolean; why: string; unknown?: boolean }> {
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
		case 'placas': {
			if (!c.solar) break;
			const said = await solarFor(w, r, c.solar);
			found = said.hit;
			none = said.none;
			break;
		}
		case 'temperatura': {
			if (!c.temperature) break;
			const t = await temperatureFor(w, r, c.temperature);
			if (t.unknown) return { ok: false, why: t.unknown, unknown: true };
			found = t.hit ?? null;
			none = t.none ?? '';
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

/**
 * All of its conditions: whether they hold, and why; `unknown`, one could not be known now (and
 * the others hold: what is missing is only that).
 */
export async function conditionsHold(w: World, r: Rule) {
	const checked = [];
	for (const c of r.spec.conditions) checked.push(await holds(w, r, c));
	return {
		ok: checked.every((c) => c.ok),
		why: checked.map((c) => c.why),
		unknown: checked.some((c) => c.unknown) && checked.every((c) => c.ok || c.unknown)
	};
}

const degreesSaid = (c: number) => `${c.toLocaleString('es-ES', { maximumFractionDigits: 1 })} °C`;
const agoSaid = (min: number) => (min < 90 ? `hace ${min} min` : `hace ${Math.round(min / 60)} h`);

/**
 * A sensor's temperature (#557): the one it names or «la casa»'s, its recent reading over or under
 * what it waits for (in words, either way); `unknown`, why it is not known now.
 */
export async function temperatureFor(w: World, r: Rule, t: TemperatureCheck) {
	const sensors = w.sensors ? await w.sensors(r) : null;
	if (!sensors) return { unknown: 'no sé la temperatura de los sensores' };
	const s = t.sensorId
		? sensors.find((x) => x.id === t.sensorId)
		: (sensors.find((x) => x.home) ?? null);
	const label = t.name ? `«${t.name}»` : 'casa';
	if (!s)
		return {
			unknown: t.sensorId
				? `el sensor ${label} ya no está en Enchufes`
				: 'no sé cuál es el sensor de casa (se marca en Enchufes → Temperatura)'
		};
	if (s.tempC === null || s.ageMin === null)
		return { unknown: `el sensor «${s.name}» todavía no ha mandado la temperatura` };
	if (s.ageMin > SENSOR_FRESH_MIN)
		return {
			unknown: `no sé la temperatura de ${label}: la última lectura de «${s.name}» es de ${agoSaid(s.ageMin)}`
		};
	const now = `en ${label} hay ${degreesSaid(s.tempC)}`;
	const hit = t.below ? s.tempC < t.degrees : s.tempC > t.degrees;
	return {
		hit: hit ? `${now}, ${t.below ? 'menos' : 'más'} de ${degreesSaid(t.degrees)}` : null,
		none: `${now}, no ${t.below ? 'menos' : 'más'} de ${degreesSaid(t.degrees)}`
	};
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

const n0 = (n: number) => Math.round(n).toLocaleString('es-ES');
const atHour = (h: number) => `a las ${h}${h < 12 ? ' de madrugada' : ''}`;

/** What the panels will do that a rule waits for (#513): in words, or why not. */
export async function solarFor(w: World, r: Rule, check: SolarCheck) {
	const days = w.solar ? await w.solar(r) : 'no sé lo que harán las placas';
	if (days === null) return { hit: null, none: 'no hay placas en Energía → Previsión' };
	if (typeof days === 'string') return { hit: null, none: days };
	const i = days.findIndex((d) => d.day === w.today);
	const today = days[i];
	if (!today) return { hit: null, none: 'la previsión de las placas no llega a ese día' };
	if (check === 'sobra_sol') {
		const hour = Number(w.time.slice(0, 2));
		const spare = today.spare;
		if (!spare) return { hit: null, none: 'hoy no sobra sol de las placas' };
		if (hour >= spare.to)
			return { hit: null, none: `ya pasó el sol que sobraba hoy (de ${spare.from} a ${spare.to})` };
		return {
			hit: `hoy sobra sol de las placas de ${Math.max(spare.from, hour)} a ${spare.to} (unos ${n0(spare.kwh)} kWh)`,
			none: ''
		};
	}
	if (check === 'bateria_no_llega')
		return today.emptyAt === null
			? { hit: null, none: 'esta noche la batería llega a la mañana' }
			: { hit: `esta noche la batería se acaba ${atHour(today.emptyAt)}`, none: '' };
	const next = days[i + 1];
	if (!next) return { hit: null, none: 'la previsión de las placas no llega a mañana' };
	return next.made < today.made * 0.5
		? {
				hit: `mañana las placas darán unos ${n0(next.made)} kWh, menos de la mitad que hoy (${n0(today.made)})`,
				none: ''
			}
		: { hit: null, none: `mañana las placas darán unos ${n0(next.made)} kWh, como hoy o más` };
}

/** What a rule waits for by the clock, due in the world's span: when, its key and why. */
export interface Due {
	at: number;
	key: string;
	why: string;
}

/**
 * One day at one time (#557) gone by more than `LATE_MINUTES` without being done (its conditions
 * did not hold then, or the server was off): never to be done.
 */
export const pastItsMoment = (r: Rule, now: number) =>
	r.spec.when.kind === 'en_fecha' &&
	Boolean(r.spec.when.day && r.spec.when.time) &&
	now > minutesOf(r.spec.when.day!, r.spec.when.time!) + LATE_MINUTES;

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
	if (when.kind === 'en_fecha' && when.day && when.time) {
		const at = atOf(when.day, when.time);
		if (due(at))
			found.push({
				at,
				key: `en_fecha:${when.day}`,
				why: `son las ${when.time} del ${dayName(when.day)}`
			});
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
