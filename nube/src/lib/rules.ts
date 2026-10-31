/**
 * A rule of the family (#331, phases 2 and 3) as data: when it is looked at, what has to hold
 * then, and whom it tells what. The AI writes it from what was said (server/rules.ts,
 * `translateRule`); the server checks it itself, without the AI. Words are matched as the voice's
 * memory does: accents and case aside, the same first five letters («tendida», «tendido»).
 */

/**
 * When: an agenda event that starts (`minutesBefore` it), a post-it or something on the list
 * that goes up, something the voice is asked to remember, a trip that starts or ends (theirs; the
 * house's, anyone's), every day at `time`; the weather that comes to be (looked at every half
 * hour), a dose still not marked `minutesAfter` its time, or something said to the voice (phase 4:
 * «cuando diga que pongo la lavadora», by its words only).
 */
export const TRIGGERS = [
	'agenda',
	'nevera',
	'recuerdo',
	'dicho',
	'viaje_empieza',
	'viaje_acaba',
	'cada_dia',
	'tiempo',
	'toma_sin_marcar'
] as const;
export type TriggerKind = (typeof TRIGGERS)[number];

/**
 * What has to hold too (or not, `negate`): being away on a trip today, something remembered, a
 * post-it or something on the list, something in today's agenda, the weather in the next hours.
 */
export const CONDITIONS = ['de_viaje', 'recuerdo', 'nevera', 'agenda_hoy', 'tiempo'] as const;
export type ConditionKind = (typeof CONDITIONS)[number];

/** The weather looked at (Open-Meteo): rain, frost, heat, wind or snow. */
export const WEATHERS = ['lluvia', 'helada', 'calor', 'viento', 'nieve'] as const;
export type WeatherKind = (typeof WEATHERS)[number];

/**
 * The weather in the next `hours` hours, at home or where its person is (on a trip, where they
 * arrived; else at home): rain from `threshold` % on, frost at or under `threshold` °C, heat at or
 * over it, wind from `threshold` km/h, any snow.
 */
export interface WeatherCheck {
	what: WeatherKind;
	hours: number;
	threshold: number;
	where: 'casa' | 'donde_este';
}

/** Each one's threshold when none is said. */
export const WEATHER_THRESHOLD: Record<WeatherKind, number> = {
	lluvia: 60,
	helada: 0,
	calor: 35,
	viento: 50,
	nieve: 0
};

/** A dose still not marked this long after its time, by default. */
export const DOSE_LATE_MIN = 30;

export interface Trigger {
	kind: TriggerKind;
	/**
	 * For agenda, nevera and recuerdo: the words it has to have («padres»); for toma_sin_marcar,
	 * whose doses (their names); none, any.
	 */
	words: string[];
	/** For agenda and the trips: this long before it starts; 0, when it starts. */
	minutesBefore: number;
	/** For cada_dia: `HH:MM`. */
	time: string | null;
	/** For tiempo. */
	weather?: WeatherCheck | null;
	/** For toma_sin_marcar: this long after its time (unset: `DOSE_LATE_MIN`). */
	minutesAfter?: number;
}

export interface Condition {
	kind: ConditionKind;
	words: string[];
	negate: boolean;
	/** For tiempo. */
	weather?: WeatherCheck | null;
}

export interface RuleNotice {
	/** Who is told: whose it is, the whole family, or these people of it. */
	to: 'yo' | 'casa' | 'personas';
	/** For `personas`: their accounts, and their names to show. */
	userIds: string[];
	names: string[];
	text: string;
	level: 'normal' | 'urgente';
}

/**
 * What a rule that deduces (phase 4) keeps: a memory of its person (the house's, if it is the
 * house's), «Hay ropa tendida», until `days` from the day it is deduced (0, that day).
 */
export interface Deduction {
	text: string;
	days: number;
}

/** A deduction lasts at most this long. */
const MAX_DEDUCED_DAYS = 30;

export interface RuleSpec {
	when: Trigger;
	conditions: Condition[];
	/** What it does: tell (`notice`), or deduce (`deduce`); unset (older ones), tell. */
	then?: 'avisar' | 'deducir';
	deduce?: Deduction | null;
	notice: RuleNotice;
	/** Told once, and then paused. */
	once: boolean;
	/**
	 * Said out loud too, on the family's satellites, when one it is for is at home (not on a trip)
	 * and it is not the quiet hours (an urgent one, even then). Unset (older ones): the house's.
	 */
	say?: boolean;
	/** Activated from one ready (rule-templates.ts, phase 7): which. */
	template?: string;
}

export const MAX_RULE = 500;
const MAX_WORDS = 8;
const MAX_CONDITIONS = 4;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
	typeof v === 'string' && (list as readonly string[]).includes(v);

const wordList = (v: unknown) =>
	(Array.isArray(v) ? v : [])
		.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
		.map((w) => w.trim().slice(0, 40))
		.slice(0, MAX_WORDS);

const clock = (v: unknown) =>
	typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null;

const within = (n: unknown, min: number, max: number, otherwise: number) => {
	const v = Math.round(Number(n));
	return Number.isFinite(v) && v !== 0 ? Math.max(min, Math.min(max, v)) : otherwise;
};

/** As the AI writes it: `ninguno` where there is none. */
export interface TranslatedWeather {
	what: string;
	hours: number;
	threshold: number | null;
	where: string;
}

/** The AI's weather, checked: null if none, or not one there is. */
function weatherOf(w: TranslatedWeather | undefined): WeatherCheck | null {
	if (!w || !isOneOf(WEATHERS, w.what)) return null;
	const threshold = Number(w.threshold);
	return {
		what: w.what,
		hours: within(w.hours, 1, 72, 12),
		threshold:
			w.threshold !== null && Number.isFinite(threshold) ? threshold : WEATHER_THRESHOLD[w.what],
		where: w.where === 'donde_este' ? 'donde_este' : 'casa'
	};
}

/** What the AI answered, as the AI's schema has it (`RULE_SCHEMA`). */
export interface TranslatedRule {
	possible: boolean;
	why_not: string | null;
	understood: string;
	when: {
		kind: string;
		words: string[];
		minutes_before: number;
		minutes_after: number;
		time: string | null;
		weather: TranslatedWeather;
	};
	conditions: { kind: string; words: string[]; negate: boolean; weather: TranslatedWeather }[];
	then: string;
	deduce: { text: string; days: number };
	notice: { to: string; people: string[]; text: string; level: string };
	once: boolean;
	say: boolean;
}

/**
 * The AI's answer checked, with the people's names already made accounts (`people`, from the
 * family's, by `resolve`): null if it is not one the server can check, with why.
 */
export function specOf(
	t: TranslatedRule,
	resolve: (name: string) => { userId: string; name: string } | null
): { spec: RuleSpec } | { problem: string } {
	if (!t.possible) return { problem: t.why_not || 'Esa regla no la sé comprobar todavía.' };
	if (!isOneOf(TRIGGERS, t.when?.kind)) return { problem: 'No he entendido cuándo mirarla.' };
	const time = clock(t.when.time);
	if (t.when.kind === 'cada_dia' && !time) return { problem: 'Falta a qué hora mirarla.' };
	const weather = weatherOf(t.when.weather);
	if (t.when.kind === 'tiempo' && !weather) return { problem: 'Falta qué tiempo esperar.' };
	const then = t.then === 'deducir' ? 'deducir' : 'avisar';
	const deduced = (t.deduce?.text ?? '').trim().slice(0, MAX_RULE);
	if (then === 'deducir' && !deduced) return { problem: 'Falta qué deducir.' };
	const text = (t.notice?.text ?? '').trim().slice(0, MAX_RULE);
	if (then === 'avisar' && !text) return { problem: 'Falta qué avisar.' };
	const to = isOneOf(['yo', 'casa', 'personas'] as const, t.notice.to) ? t.notice.to : 'yo';
	const people =
		to === 'personas' ? (t.notice.people ?? []).map((n) => ({ n, p: resolve(n) })) : [];
	const missing = people.filter((x) => !x.p).map((x) => x.n);
	if (missing.length)
		return { problem: `No hay nadie con cuenta llamado ${missing.join(', ')} en la familia.` };
	if (then === 'avisar' && to === 'personas' && !people.length)
		return { problem: 'Falta a quién avisar.' };
	return {
		spec: {
			when: {
				kind: t.when.kind,
				words: wordList(t.when.words),
				minutesBefore: Math.max(
					0,
					Math.min(7 * 24 * 60, Math.round(Number(t.when.minutes_before) || 0))
				),
				time,
				...(t.when.kind === 'tiempo' ? { weather } : {}),
				...(t.when.kind === 'toma_sin_marcar'
					? { minutesAfter: within(t.when.minutes_after, 1, 24 * 60, DOSE_LATE_MIN) }
					: {})
			},
			conditions: (Array.isArray(t.conditions) ? t.conditions : [])
				.filter(
					(c) => isOneOf(CONDITIONS, c?.kind) && (c.kind !== 'tiempo' || weatherOf(c.weather))
				)
				.slice(0, MAX_CONDITIONS)
				.map((c) => ({
					kind: c.kind as ConditionKind,
					words: wordList(c.words),
					negate: c.negate === true,
					...(c.kind === 'tiempo' ? { weather: weatherOf(c.weather) } : {})
				})),
			then,
			deduce:
				then === 'deducir'
					? { text: deduced, days: within(t.deduce.days, 0, MAX_DEDUCED_DAYS, 0) }
					: null,
			notice: {
				to,
				userIds: people.map((x) => x.p!.userId),
				names: people.map((x) => x.p!.name),
				text,
				level: t.notice.level === 'urgente' ? 'urgente' : 'normal'
			},
			once: t.once === true,
			say: t.say === true
		}
	};
}

const words = { type: 'array', items: { type: 'string' } };
const weatherSchema = {
	type: 'object',
	additionalProperties: false,
	required: ['what', 'hours', 'threshold', 'where'],
	properties: {
		what: { type: 'string', enum: ['ninguno', ...WEATHERS] },
		hours: { type: 'integer' },
		threshold: { type: ['number', 'null'] },
		where: { type: 'string', enum: ['casa', 'donde_este'] }
	}
};

/** The AI's answer, strict (every property, no others): what `specOf` takes. */
export const RULE_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: [
		'possible',
		'why_not',
		'understood',
		'when',
		'conditions',
		'then',
		'deduce',
		'notice',
		'once',
		'say'
	],
	properties: {
		possible: { type: 'boolean' },
		why_not: { type: ['string', 'null'] },
		understood: { type: 'string' },
		when: {
			type: 'object',
			additionalProperties: false,
			required: ['kind', 'words', 'minutes_before', 'minutes_after', 'time', 'weather'],
			properties: {
				kind: { type: 'string', enum: [...TRIGGERS] },
				words,
				minutes_before: { type: 'integer' },
				minutes_after: { type: 'integer' },
				time: { type: ['string', 'null'] },
				weather: weatherSchema
			}
		},
		conditions: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'words', 'negate', 'weather'],
				properties: {
					kind: { type: 'string', enum: [...CONDITIONS] },
					words,
					negate: { type: 'boolean' },
					weather: weatherSchema
				}
			}
		},
		then: { type: 'string', enum: ['avisar', 'deducir'] },
		deduce: {
			type: 'object',
			additionalProperties: false,
			required: ['text', 'days'],
			properties: { text: { type: 'string' }, days: { type: 'integer' } }
		},
		notice: {
			type: 'object',
			additionalProperties: false,
			required: ['to', 'people', 'text', 'level'],
			properties: {
				to: { type: 'string', enum: ['yo', 'casa', 'personas'] },
				people: words,
				text: { type: 'string' },
				level: { type: 'string', enum: ['normal', 'urgente'] }
			}
		},
		once: { type: 'boolean' },
		say: { type: 'boolean' }
	}
} as const;
