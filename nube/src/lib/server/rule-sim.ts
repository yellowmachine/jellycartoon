import {
	boughtWhy,
	conditionsHold,
	fittingAll,
	dueIn,
	fits,
	MAX_CHAIN,
	momentOf,
	quoted,
	waitsFor,
	weatherFor,
	type Rule,
	type Trip,
	type World
} from '#lib/server/rule-check.ts';
import { addDays } from 'comun/agenda.ts';
import { hasWords } from '#lib/server/voice/learned.ts';
import type { HourAhead } from 'comun/weather.ts';
import type { RuleSpec } from '#lib/rules.ts';

/**
 * «¿Qué pasaría…?» (#389): a family's rules (#331) looked at in a span of a day to come, in the
 * order things would happen, with what each would do and why; and nothing told, nothing kept.
 * What is due by the clock, at its time; the weather, every half hour, as the server looks; what a
 * rule deduces, remembered for the ones after it (and for the rules waiting for a memory, as a
 * chain, as the server does). What waits for something to happen (a post-it, something said or
 * remembered), only whether it would hold if it happened then.
 */

/** The rule written to try, not saved: its id. */
export const DRAFT_ID = 0;
/** The weather, looked at this often in the span, as the server does. */
const WEATHER_EVERY_MIN = 30;

/**
 * «Y si…» (phase 2): what is changed in the moment simulated. The weather, made up for the whole
 * span instead of the forecast; the one who looks, away on a trip that day; Medicación's doses, all
 * marked or none; and something that happens at its start: said to the voice, put on the fridge,
 * asked to remember, by the one who looks; or bought (#451: what, separated by commas).
 */
export interface WhatIf {
	weather: WeatherIf;
	away: boolean;
	doses: 'como_esten' | 'sin_marcar' | 'marcadas';
	happens: { kind: 'dicho' | 'nevera' | 'recuerdo' | 'compra'; text: string } | null;
}

export const WEATHER_IFS = [
	'prevision',
	'lluvia',
	'sin_lluvia',
	'helada',
	'calor',
	'viento',
	'nieve'
] as const;
export type WeatherIf = (typeof WEATHER_IFS)[number];

export const NO_IFS: WhatIf = {
	weather: 'prevision',
	away: false,
	doses: 'como_esten',
	happens: null
};

/**
 * The weather `what`, every hour from `day` at `time`'s, for `hours`: the rest calm (15 °C, no
 * rain, little wind), so only what was asked for holds.
 */
export function madeUpWeather(day: string, time: string, what: WeatherIf, hours = 72): HourAhead[] {
	const start = Date.UTC(
		Number(day.slice(0, 4)),
		Number(day.slice(5, 7)) - 1,
		Number(day.slice(8, 10)),
		Number(time.slice(0, 2))
	);
	return Array.from({ length: hours }, (_, i) => ({
		at: new Date(start + i * 3_600_000).toISOString().slice(0, 16),
		temperature: what === 'helada' ? -3 : what === 'calor' ? 38 : what === 'nieve' ? -1 : 15,
		rain: what === 'lluvia' || what === 'nieve' ? 90 : 0,
		wind: what === 'viento' ? 70 : 10,
		code: what === 'nieve' ? 73 : what === 'lluvia' ? 61 : 1
	}));
}

/** A trip of the one who looks, from the day before to the day after: away all that day. */
function awayTrip(day: string, home: { lat: number; lon: number } | null): Trip {
	const at: [number, number] = home ? [home.lon, home.lat] : [0, 0];
	const leg = (d: string, id: number) => ({
		id,
		day: d,
		time: '12:00',
		from: 'casa',
		to: 'tu viaje',
		start: at,
		end: at,
		distance: 0,
		duration: 0
	});
	const legs = [leg(addDays(day, -1), -1), leg(addDays(day, 1), -2)];
	return {
		trip: { id: -1, name: 'un viaje (de prueba)', private: true, mine: true, people: [], legs },
		first: legs[0]!,
		last: legs[1]!
	};
}

/** The world `w` with what `ifs` changes, for `me`, the one who looks. */
export function withIfs(w: World, ifs: WhatIf, me: string): World {
	const happens = ifs.happens?.text.trim() ? ifs.happens : null;
	const what = ifs.weather;
	return {
		...w,
		forecast:
			what === 'prevision'
				? w.forecast
				: async (_lat, _lon, day, time) => madeUpWeather(day, time, what),
		trips: !ifs.away
			? w.trips
			: async (r) => {
					const trips = await w.trips(r);
					return r.userId && r.userId !== me
						? trips
						: [...trips, awayTrip(w.today, await w.home(r))];
				},
		doses:
			ifs.doses === 'como_esten'
				? w.doses
				: async (r, day) =>
						(await w.doses(r, day)).map((d) => ({ ...d, taken: ifs.doses === 'marcadas' })),
		fridge:
			happens?.kind === 'nevera' ? async (r) => [happens.text, ...(await w.fridge(r))] : w.fridge,
		memories:
			happens?.kind === 'recuerdo'
				? async (r) => [
						...(r.userId === me ? [{ text: happens.text }] : []),
						...(await w.memories(r))
					]
				: w.memories
	};
}

/** What a simulation deduced, remembered for the rest of it: whose (null, the house's). */
export interface Deduced {
	userId: string | null;
	text: string;
	because: string;
}

export interface Outcome {
	/** Null, the rule written to try. */
	id: number | null;
	understood: string;
	/** `HH:MM` it would do it, or holds at; null, it does not wait for the clock. */
	at: string | null;
	/** What it would do: tell, keep a fact; null, nothing. */
	does: 'avisa' | 'deduce' | null;
	said: string;
}

/** What it waits for, in words: «cada día a las 21:00». */
export function whenSaid(when: RuleSpec['when']) {
	const about = when.words.length ? `algo con ${quoted(when.words)}` : 'algo';
	const before = when.minutesBefore
		? when.minutesBefore % 1440 === 0
			? ` (${when.minutesBefore / 1440} día${when.minutesBefore === 1440 ? '' : 's'} antes)`
			: ` (${when.minutesBefore} min antes)`
		: '';
	switch (when.kind) {
		case 'cada_dia':
			return `cada día a las ${when.time}`;
		case 'agenda':
			return `cuando empieza en la Agenda ${about}${before}`;
		case 'viaje_empieza':
			return `cuando empieza un viaje${before}`;
		case 'viaje_acaba':
			return `cuando acaba un viaje${before}`;
		case 'toma_sin_marcar':
			return `cuando una toma de Medicación${when.words.length ? ` de ${when.words.join(' o ')}` : ''} sigue sin marcar`;
		case 'nevera':
			return `cuando ponen en la nevera ${about}`;
		case 'recuerdo':
			return `cuando le piden a la voz recordar ${about}`;
		case 'dicho':
			return `cuando le dicen a la voz ${about}`;
		case 'compra':
			return `cuando se guarda una compra con ${about}`;
		case 'tiempo':
			return 'cuando cambia el tiempo';
	}
}

const EVENT_KINDS = new Set(['nevera', 'recuerdo', 'dicho', 'compra']);

/** What a made-up purchase has: «cerveza, leche» is two lines. */
export const boughtItems = (text: string) =>
	text
		.split(/[,;\n]/)
		.map((t) => t.trim())
		.filter(Boolean)
		.slice(0, 30);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a rule would do, in words: «deduciría «Hay ropa tendida»», «avisaría». */
const doesSaid = (r: Rule) =>
	r.spec.then === 'deducir' && r.spec.deduce ? `deduciría «${r.spec.deduce.text}»` : 'avisaría';

/**
 * The rules, in the span `from`…`to` (minutes, as `minutesOf`, the same day). `world`, the world
 * at a minute, remembering `deduced` too; `tells`, to whom and how a notice would go then
 * («te avisaría en el Buzón y en el móvil, y en voz alta en casa»), and why not out loud.
 */
export async function simulate({
	rules,
	from,
	to,
	happens = null,
	world,
	tells
}: {
	rules: Rule[];
	from: number;
	to: number;
	/** Something that happens at `from` («y si…»), and whose it is (null: the house's). */
	happens?: (WhatIf['happens'] & { ownerId: string | null }) | null;
	world: (minute: number, deduced: readonly Deduced[]) => World;
	tells: (r: Rule, w: World) => Promise<{ how: string; after?: string }>;
}): Promise<Outcome[]> {
	const deduced: Deduced[] = [];
	const at = (minute: number) => ({ ...world(minute, deduced), from, to });
	const outcomes: (Outcome & { minute: number })[] = [];
	const done = new Set<number>();
	const missed = new Map<number, { minute: number; why: string }>();
	const said = (r: Rule, minute: number | null, does: Outcome['does'], text: string) =>
		outcomes.push({
			id: r.id === DRAFT_ID ? null : r.id,
			understood: r.understood,
			at: minute === null ? null : momentOf(minute).time,
			does,
			said: text,
			minute: minute ?? Number.MAX_SAFE_INTEGER
		});

	async function act(r: Rule, w: World, minute: number, why: string, chain: number[]) {
		done.add(r.id);
		const { deduce } = r.spec;
		if (r.spec.then === 'deducir' && deduce) {
			deduced.push({ userId: r.userId, text: deduce.text, because: `porque ${why}` });
			said(
				r,
				minute,
				'deduce',
				`Deduciría «${deduce.text}»${deduce.days ? ` (vale ${deduce.days} día${deduce.days === 1 ? '' : 's'} más)` : ' (vale ese día)'}, porque ${why}.`
			);
			// The rules waiting for a memory, through this one, as the server's chain.
			const through = [...chain, r.id];
			for (const q of rules) {
				if (q.paused || q.spec.when.kind !== 'recuerdo' || done.has(q.id)) continue;
				if (r.userId && q.userId !== r.userId) continue;
				if (through.includes(q.id) || through.length >= MAX_CHAIN) continue;
				const fit = await fits(w, q, q.spec.when.words, 'recuerdo', deduce.text);
				if (!fit.ok) continue;
				const because = `se deduce «${deduce.text}»${fit.why}`;
				const holds = await conditionsHold(w, q);
				if (holds.ok) await act(q, w, minute, [because, ...holds.why].join(' y '), through);
				else missed.set(q.id, { minute, why: [because, ...holds.why].join(' pero ') });
			}
			return;
		}
		const { how, after } = await tells(r, w);
		said(
			r,
			minute,
			'avisa',
			`${capital(how)}: «${r.spec.notice.text}». Porque ${why}.${after ? ` ${after}` : ''}`
		);
	}

	const active = rules.filter((r) => !r.paused);
	const start = at(from);

	// What happens at its start, for the rules waiting for it (as the server's `onEvent`).
	if (happens?.text.trim()) {
		const { kind, text, ownerId } = happens;
		const time = momentOf(from).time;
		for (const r of active) {
			if (r.spec.when.kind !== kind || !waitsFor(r, kind, ownerId)) continue;
			if (kind === 'compra') {
				const found = await fittingAll(start, r, r.spec.when.words, kind, boughtItems(text));
				if (!found.length) {
					missed.set(r.id, {
						minute: from,
						why: `«${text}» no tiene ${quoted(r.spec.when.words)}`
					});
					continue;
				}
				const because = boughtWhy('', found);
				const holds = await conditionsHold(start, r);
				if (holds.ok) await act(r, start, from, [because, ...holds.why].join(' y '), []);
				else missed.set(r.id, { minute: from, why: [because, ...holds.why].join(' pero ') });
				continue;
			}
			const fit =
				kind === 'dicho'
					? { ok: hasWords(r.spec.when.words, text), why: '' }
					: await fits(start, r, r.spec.when.words, kind, text);
			if (!fit.ok) {
				missed.set(r.id, { minute: from, why: `«${text}» no dice ${quoted(r.spec.when.words)}` });
				continue;
			}
			const because =
				(kind === 'nevera'
					? `ponen en la nevera «${text}»`
					: kind === 'dicho'
						? `dicen «${text}» a las ${time}`
						: `piden recordar «${text}»`) + fit.why;
			const holds = await conditionsHold(start, r);
			if (holds.ok) await act(r, start, from, [because, ...holds.why].join(' y '), []);
			else missed.set(r.id, { minute: from, why: [because, ...holds.why].join(' pero ') });
		}
	}

	// What would happen by the clock and the weather, in its order.
	const comes: { minute: number; r: Rule; why: string }[] = [];
	for (const r of active) {
		if (EVENT_KINDS.has(r.spec.when.kind)) continue;
		const weather = r.spec.when.kind === 'tiempo' ? r.spec.when.weather : null;
		if (weather) {
			for (let minute = from; minute <= to; minute += WEATHER_EVERY_MIN) {
				const { hit } = await weatherFor(at(minute), r, weather);
				if (hit) comes.push({ minute, r, why: hit });
			}
		} else for (const due of await dueIn(start, r)) comes.push({ minute: due.at, r, why: due.why });
	}
	comes.sort((a, b) => a.minute - b.minute);
	for (const { minute, r, why } of comes) {
		// Once a day, as the server: the weather's, its once-only ones; the rest, each time it is due.
		if (done.has(r.id) && (r.spec.once || r.spec.when.kind === 'tiempo')) continue;
		const w = at(minute);
		const holds = await conditionsHold(w, r);
		if (holds.ok) await act(r, w, minute, [why, ...holds.why].join(' y '), []);
		else missed.set(r.id, { minute, why: [why, ...holds.why].join(' pero ') });
	}

	// And the rest: why not, or what they wait for.
	for (const r of rules) {
		if (done.has(r.id)) continue;
		if (r.paused) {
			said(r, null, null, 'En pausa: no haría nada.');
			continue;
		}
		const miss = missed.get(r.id);
		if (miss) {
			said(r, miss.minute, null, `No ${doesSaid(r)}: ${miss.why}.`);
			continue;
		}
		const { when } = r.spec;
		if (EVENT_KINDS.has(when.kind)) {
			const holds = await conditionsHold(start, r);
			said(
				r,
				null,
				null,
				`Se mira ${whenSaid(when)}. ${
					!r.spec.conditions.length
						? `Si pasara entonces, ${doesSaid(r)}.`
						: holds.ok
							? `Si pasara entonces, ${doesSaid(r)}: ${holds.why.join(' y ')}.`
							: `Si pasara entonces, no ${doesSaid(r)}: ${holds.why.join(' y ')}.`
				}`
			);
			continue;
		}
		if (when.kind === 'tiempo' && when.weather) {
			const { none } = await weatherFor(start, r, when.weather);
			said(r, null, null, `No ${doesSaid(r)}: ${none}.`);
			continue;
		}
		said(r, null, null, `Entonces no le toca: se mira ${whenSaid(when)}.`);
	}
	return outcomes.sort((a, b) => a.minute - b.minute).map(({ minute: _, ...outcome }) => outcome);
}
