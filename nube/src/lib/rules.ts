/**
 * A rule of the family (#331, phases 2 and 3) as data: when it is looked at, what has to hold
 * then, and whom it tells what. The AI writes it from what was said (server/rules.ts,
 * `translateRule`); the server checks it itself, without the AI. Words are matched as the voice's
 * memory does: accents and case aside, the same first five letters («tendida», «tendido»).
 */

import { dayName } from 'comun/agenda.ts';
import { timeLabel } from 'comun/timer-names.ts';

/**
 * When: an agenda event that starts (`minutesBefore` it), a post-it or something on the list
 * that goes up, something the voice is asked to remember, a trip that starts or ends (theirs; the
 * house's, anyone's), every day at `time`; the weather that comes to be (looked at every half
 * hour), a dose still not marked `minutesAfter` its time, something said to the voice (phase 4:
 * «cuando diga que pongo la lavadora», by its words only), a purchase saved in Gastos (#451:
 * «si compro bebida», by what it has), a plug's appliance that starts or ends a cycle (#528:
 * «cuando acabe la lavadora», by the plug's name or kind), or one day at one time (#557, an
 * errand: «mañana a las 9», once).
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
	'toma_sin_marcar',
	'compra',
	'enchufe',
	'en_fecha'
] as const;
export type TriggerKind = (typeof TRIGGERS)[number];

/**
 * A plug's moment (#528), as plugs/watch.ts reads its watts: a cycle starts (working a few
 * minutes: a wash, not a blip) or ends (idle a few minutes after one).
 */
export const PLUG_MOMENTS = ['empieza', 'termina'] as const;
export type PlugMoment = (typeof PLUG_MOMENTS)[number];

/**
 * What has to hold too (or not, `negate`): being away on a trip today, something remembered, a
 * post-it or something on the list, something in today's agenda, the weather in the next hours,
 * what the solar panels will do (Energía → Previsión, #513), or the temperature a sensor reads at
 * home (#508, #557: «si en casa hay menos de 15 grados»).
 */
export const CONDITIONS = [
	'de_viaje',
	'recuerdo',
	'nevera',
	'agenda_hoy',
	'tiempo',
	'placas',
	'temperatura'
] as const;
export type ConditionKind = (typeof CONDITIONS)[number];

/**
 * The panels' (#513 phase 4), as Energía → Previsión forecasts them: sun to spare today (still to
 * come), the battery not lasting tonight, or little sun tomorrow (less than half of today's).
 */
export const SOLAR_CHECKS = ['sobra_sol', 'bateria_no_llega', 'poco_sol_manana'] as const;
export type SolarCheck = (typeof SOLAR_CHECKS)[number];

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
	 * For agenda, nevera, recuerdo and compra: the words it has to have («padres»); for toma_sin_marcar,
	 * whose doses (their names); for enchufe, the plug's name or kind («lavadora»); none, any.
	 */
	words: string[];
	/** For agenda and the trips: this long before it starts; 0, when it starts. */
	minutesBefore: number;
	/** For cada_dia and en_fecha: `HH:MM`. */
	time: string | null;
	/** For en_fecha (#557): `YYYY-MM-DD`. */
	day?: string | null;
	/** For tiempo. */
	weather?: WeatherCheck | null;
	/** For toma_sin_marcar: this long after its time (unset: `DOSE_LATE_MIN`). */
	minutesAfter?: number;
	/** For enchufe: when its cycle starts or ends. */
	plug?: PlugMoment;
}

/**
 * A sensor's temperature (#557): under or over `degrees` °C, in that sensor (its id, and its name
 * then, to show) or, with none, in the one of «la casa» (marked in Enchufes → Temperatura, or the
 * only one), as it is when looked at. Only a recent reading counts (rule-check.ts).
 */
export interface TemperatureCheck {
	sensorId: string | null;
	name: string | null;
	below: boolean;
	degrees: number;
}

/** «en casa hay menos de 15 °C», «en «Dormitorio» hay más de 25 °C». */
export const temperatureSaid = (t: TemperatureCheck) =>
	`en ${t.name ? `«${t.name}»` : 'casa'} hay ${t.below ? 'menos' : 'más'} de ${t.degrees.toLocaleString('es-ES')} °C`;

export interface Condition {
	kind: ConditionKind;
	words: string[];
	negate: boolean;
	/** For tiempo. */
	weather?: WeatherCheck | null;
	/** For placas. */
	solar?: SolarCheck | null;
	/** For temperatura. */
	temperature?: TemperatureCheck | null;
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

/**
 * What a rule that starts a timer keeps: one of the house's, `minutes` from then, rung in the whole
 * house with `label` (alarms.ts, `startTimerAt`): «Saca las bebidas del congelador», an hour after
 * the purchase.
 */
export interface RuleTimer {
	minutes: number;
	label: string;
}

/** What it would do, in words: «pondría un temporizador de 1 hora en casa: «Sacar las bebidas…»». */
export const timerSaid = (t: RuleTimer, verb: string) =>
	`${verb} un temporizador de ${timeLabel(t.minutes * 60)} en casa: «${t.label}»`;

/**
 * What a rule that switches a plug keeps (#557, an errand: «a las 9 pon el termo una hora»): which
 * plug of Enchufes (its id, and its name as it was then, to show), on or off, and for how long
 * (null, it stays so), with the plug's own timer (`toggle_after`), so it goes back even without
 * Seilide. Its padlock and its pause are looked at when it is done, as by voice.
 */
export interface RulePlug {
	plugId: string;
	name: string;
	on: boolean;
	minutes: number | null;
	/**
	 * Set: its pause put (true) or taken off (false) instead of switching it («pon el termo en pausa
	 * el lunes»); `on` and `minutes`, then, unused. Unset (older ones): switched.
	 */
	pause?: boolean;
}

/** A rule switches a plug for at most this long: a misunderstood one is a heater on all day. */
export const MAX_PLUG_MIN = 4 * 60;

/** How a plug's action is said: done, would do, will do, or to do. */
export type PlugTense = 'hecho' | 'haria' | 'hara' | 'hacer';
const PLUG_VERBS: Record<'on' | 'off' | 'pause' | 'unpause', Record<PlugTense, string>> = {
	on: { hecho: 'encendido', haria: 'encendería', hara: 'encenderá', hacer: 'encender' },
	off: { hecho: 'apagado', haria: 'apagaría', hara: 'apagará', hacer: 'apagar' },
	pause: {
		hecho: 'puesto en pausa',
		haria: 'pondría en pausa',
		hara: 'pondrá en pausa',
		hacer: 'poner en pausa'
	},
	unpause: {
		hecho: 'quitado la pausa de',
		haria: 'quitaría la pausa de',
		hara: 'quitará la pausa de',
		hacer: 'quitar la pausa de'
	}
};

/** «encendería», «puesto en pausa», «quitar la pausa de»: the verb, without the plug. */
export const plugVerb = (p: RulePlug, tense: PlugTense) =>
	PLUG_VERBS[p.pause === undefined ? (p.on ? 'on' : 'off') : p.pause ? 'pause' : 'unpause'][tense];

/** «encendería «Termo» 1 hora», «apagado «Tele»», «pondrá en pausa «Termo»». */
export const plugSaid = (p: RulePlug, tense: PlugTense) =>
	`${plugVerb(p, tense)} «${p.name}»${p.pause === undefined && p.minutes ? ` ${timeLabel(p.minutes * 60)}` : ''}`;

/** A rule's timer lasts at most a day (`MAX_TIMER_SEC`). */
const MAX_TIMER_MIN = 24 * 60;

/** A deduction lasts at most this long. */
const MAX_DEDUCED_DAYS = 30;

export const ACTIONS = ['avisar', 'deducir', 'temporizador', 'enchufe'] as const;
export type RuleAction = (typeof ACTIONS)[number];

export interface RuleSpec {
	when: Trigger;
	conditions: Condition[];
	/**
	 * What it does: tell (`notice`), deduce (`deduce`), start a timer in the house (`timer`) or
	 * switch a plug (`plug`, #557; its notice, only if it cannot); unset (older ones), tell.
	 */
	then?: RuleAction;
	deduce?: Deduction | null;
	timer?: RuleTimer | null;
	plug?: RulePlug | null;
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

/** An errand's moment (#557): «el sábado 21 a las 09:00»; empty for other rules. */
export const errandWhen = (when: Pick<Trigger, 'kind' | 'day' | 'time'>) =>
	when.kind === 'en_fecha' && when.day && when.time
		? `el ${dayName(when.day)} a las ${when.time}`
		: '';

/**
 * A rule as it is read (#557, phase 3): an errand's sentence carries no day nor time, so it can be
 * moved without the AI; they go first, from its data: «El sábado 21 a las 09:00: si en casa…».
 */
export function ruleSaid(r: { understood: string; spec: Pick<RuleSpec, 'when'> }) {
	const at = errandWhen(r.spec.when);
	if (!at) return r.understood;
	return `${at.charAt(0).toUpperCase()}${at.slice(1)}: ${r.understood.charAt(0).toLowerCase()}${r.understood.slice(1)}`;
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

/** `YYYY-MM-DD`, a real day. */
const dayOf = (v: unknown) => {
	if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
	const d = new Date(`${v}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : null;
};

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

/** The AI's temperature, checked: the sensor by its name, or why not. */
function temperatureOf(
	v: { sensor: string; compare: string; degrees: number } | undefined,
	sensors: { id: string; name: string }[]
): TemperatureCheck | string {
	if (!sensors.length) return 'La familia no tiene sensores de temperatura en Enchufes.';
	const degrees = Number(v?.degrees);
	if (!v || !['menos_de', 'mas_de'].includes(v.compare) || !Number.isFinite(degrees))
		return 'Falta qué temperatura esperar.';
	const said = (v.sensor ?? '').trim();
	const sensor = /^(la )?casa$/i.test(said) || !said ? null : sensors.find((s) => s.name === said);
	if (sensor === undefined)
		return `No hay un sensor «${said}»: los hay ${sensors.map((s) => `«${s.name}»`).join(', ')}.`;
	return {
		sensorId: sensor?.id ?? null,
		name: sensor?.name ?? null,
		below: v.compare === 'menos_de',
		degrees: Math.round(degrees * 10) / 10
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
		/** `ninguno` where there is none. */
		plug?: string;
		/** For en_fecha: `YYYY-MM-DD`; null in the others. */
		day?: string | null;
	};
	conditions: {
		kind: string;
		words: string[];
		negate: boolean;
		weather: TranslatedWeather;
		/** `ninguno` where there is none. */
		solar?: string;
		/** For temperatura: the sensor's name as in the list or «casa», and `ninguno` elsewhere. */
		temperature?: { sensor: string; compare: string; degrees: number };
	}[];
	then: string;
	deduce: { text: string; days: number };
	timer: { minutes: number; label: string };
	/**
	 * For «enchufe»: the plug's name as in the list, on or off, and minutes (0, it stays so); or its
	 * pause put or taken off (`ninguno`, switched).
	 */
	plug_switch?: { plug: string; on: boolean; minutes: number; pause?: string };
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
	resolve: (name: string) => { userId: string; name: string } | null,
	{
		plugs = [],
		sensors = [],
		now = null
	}: {
		/** The family's plugs (#557), to switch one by its name. */
		plugs?: { id: string; name: string }[];
		/** Its temperature sensors (#557), to look at one by its name. */
		sensors?: { id: string; name: string }[];
		/** The wall's day and time: a moment already gone is not one to wait for. */
		now?: { day: string; time: string } | null;
	} = {}
): { spec: RuleSpec } | { problem: string } {
	if (!t.possible) return { problem: t.why_not || 'Esa regla no la sé comprobar todavía.' };
	if (!isOneOf(TRIGGERS, t.when?.kind)) return { problem: 'No he entendido cuándo mirarla.' };
	const time = clock(t.when.time);
	if ((t.when.kind === 'cada_dia' || t.when.kind === 'en_fecha') && !time)
		return { problem: 'Falta a qué hora mirarla.' };
	const day = dayOf(t.when.day);
	if (t.when.kind === 'en_fecha' && !day) return { problem: 'Falta qué día.' };
	if (t.when.kind === 'en_fecha' && now && `${day} ${time}` < `${now.day} ${now.time}`)
		return { problem: `Las ${time} del ${day} ya han pasado.` };
	const weather = weatherOf(t.when.weather);
	if (t.when.kind === 'tiempo' && !weather) return { problem: 'Falta qué tiempo esperar.' };
	const then = isOneOf(ACTIONS, t.then) ? t.then : 'avisar';
	const asked = t.plug_switch;
	const switched = then === 'enchufe' ? (plugs.find((p) => p.name === asked?.plug) ?? null) : null;
	if (then === 'enchufe' && !switched)
		return {
			problem: plugs.length
				? `No hay un enchufe «${asked?.plug ?? ''}»: los hay ${plugs.map((p) => `«${p.name}»`).join(', ')}.`
				: 'La familia no tiene enchufes en Enchufes.'
		};
	// A sensor's temperature (#557): by its name, or «la casa»'s; one there is not, said.
	const temperatures = (Array.isArray(t.conditions) ? t.conditions : []).map((c) =>
		c?.kind === 'temperatura' ? temperatureOf(c.temperature, sensors) : null
	);
	const wrong = temperatures.find((x) => typeof x === 'string');
	if (wrong) return { problem: wrong };
	const pause = asked?.pause === 'poner' ? true : asked?.pause === 'quitar' ? false : undefined;
	const plugMinutes = pause === undefined ? Math.round(Number(asked?.minutes) || 0) : 0;
	if (then === 'enchufe' && (plugMinutes < 0 || plugMinutes > MAX_PLUG_MIN))
		return { problem: `Un enchufe se programa como mucho ${timeLabel(MAX_PLUG_MIN * 60)}.` };
	const deduced = (t.deduce?.text ?? '').trim().slice(0, MAX_RULE);
	if (then === 'deducir' && !deduced) return { problem: 'Falta qué deducir.' };
	const minutes = Math.round(Number(t.timer?.minutes));
	if (then === 'temporizador' && !(minutes > 0))
		return { problem: 'Falta cuánto tiene que durar el temporizador.' };
	const label = (t.timer?.label ?? '').trim().slice(0, 60);
	if (then === 'temporizador' && !label) return { problem: 'Falta para qué es el temporizador.' };
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
				...(t.when.kind === 'en_fecha' ? { day } : {}),
				...(t.when.kind === 'tiempo' ? { weather } : {}),
				...(t.when.kind === 'toma_sin_marcar'
					? { minutesAfter: within(t.when.minutes_after, 1, 24 * 60, DOSE_LATE_MIN) }
					: {}),
				// «Cuando la lavadora…», without saying which: when it ends, as the template's.
				...(t.when.kind === 'enchufe'
					? { plug: isOneOf(PLUG_MOMENTS, t.when.plug) ? t.when.plug : 'termina' }
					: {})
			},
			conditions: (Array.isArray(t.conditions) ? t.conditions : [])
				.map((c, i) => ({ c, temperature: temperatures[i] }))
				.filter(
					({ c }) =>
						isOneOf(CONDITIONS, c?.kind) &&
						(c.kind !== 'tiempo' || weatherOf(c.weather)) &&
						(c.kind !== 'placas' || isOneOf(SOLAR_CHECKS, c.solar))
				)
				.slice(0, MAX_CONDITIONS)
				.map(({ c, temperature }) => ({
					kind: c.kind as ConditionKind,
					words: wordList(c.words),
					negate: c.negate === true,
					...(c.kind === 'tiempo' ? { weather: weatherOf(c.weather) } : {}),
					...(c.kind === 'placas' ? { solar: c.solar as SolarCheck } : {}),
					...(c.kind === 'temperatura' && temperature && typeof temperature !== 'string'
						? { temperature }
						: {})
				})),
			then,
			deduce:
				then === 'deducir'
					? { text: deduced, days: within(t.deduce.days, 0, MAX_DEDUCED_DAYS, 0) }
					: null,
			timer: then === 'temporizador' ? { minutes: Math.min(minutes, MAX_TIMER_MIN), label } : null,
			...(then === 'enchufe' && switched
				? {
						plug: {
							plugId: switched.id,
							name: switched.name,
							on: pause === undefined && asked?.on !== false,
							minutes: plugMinutes || null,
							...(pause === undefined ? {} : { pause })
						}
					}
				: {}),
			notice: {
				to,
				userIds: people.map((x) => x.p!.userId),
				names: people.map((x) => x.p!.name),
				text,
				level: t.notice.level === 'urgente' ? 'urgente' : 'normal'
			},
			// One day at one time: once, whatever it said.
			once: t.once === true || t.when.kind === 'en_fecha',
			// A timer rings in the whole house by itself; a plug only tells if it cannot.
			say: then === 'temporizador' || then === 'enchufe' ? false : t.say === true
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
		'timer',
		'plug_switch',
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
			required: [
				'kind',
				'words',
				'minutes_before',
				'minutes_after',
				'time',
				'day',
				'weather',
				'plug'
			],
			properties: {
				kind: { type: 'string', enum: [...TRIGGERS] },
				words,
				minutes_before: { type: 'integer' },
				minutes_after: { type: 'integer' },
				time: { type: ['string', 'null'] },
				day: { type: ['string', 'null'] },
				weather: weatherSchema,
				plug: { type: 'string', enum: ['ninguno', ...PLUG_MOMENTS] }
			}
		},
		conditions: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['kind', 'words', 'negate', 'weather', 'solar', 'temperature'],
				properties: {
					kind: { type: 'string', enum: [...CONDITIONS] },
					words,
					negate: { type: 'boolean' },
					weather: weatherSchema,
					solar: { type: 'string', enum: ['ninguno', ...SOLAR_CHECKS] },
					temperature: {
						type: 'object',
						additionalProperties: false,
						required: ['sensor', 'compare', 'degrees'],
						properties: {
							sensor: { type: 'string' },
							compare: { type: 'string', enum: ['ninguno', 'menos_de', 'mas_de'] },
							degrees: { type: 'number' }
						}
					}
				}
			}
		},
		then: { type: 'string', enum: [...ACTIONS] },
		deduce: {
			type: 'object',
			additionalProperties: false,
			required: ['text', 'days'],
			properties: { text: { type: 'string' }, days: { type: 'integer' } }
		},
		timer: {
			type: 'object',
			additionalProperties: false,
			required: ['minutes', 'label'],
			properties: { minutes: { type: 'integer' }, label: { type: 'string' } }
		},
		plug_switch: {
			type: 'object',
			additionalProperties: false,
			required: ['plug', 'on', 'minutes', 'pause'],
			properties: {
				plug: { type: 'string' },
				on: { type: 'boolean' },
				minutes: { type: 'integer' },
				pause: { type: 'string', enum: ['ninguno', 'poner', 'quitar'] }
			}
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
