import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { addDays, dayName, localDay, localTime } from 'comun/agenda.ts';
import { rule } from '#lib/server/db/schema.ts';
import {
	agendaBetween,
	agendaPeople,
	familyAccounts,
	familyPeople,
	personOf
} from '#lib/server/agenda/agenda.ts';
import { familyPlace, openRouterKey } from '#lib/server/family-settings.ts';
import { familyHasHouse, sendHouse } from '#lib/server/house.ts';
import { dosesFor, listMedication } from '#lib/server/medication.ts';
import { hoursAhead, type HourAhead } from 'comun/weather.ts';
import { fridgeState, houseKitchen, kitchenOf, type Kitchen } from '#lib/server/fridge.ts';
import { keepQuietly, tell } from '#lib/server/inbox.ts';
import { startTimerAt } from '#lib/server/alarms/alarms.ts';
import { listMemories, remember } from '#lib/server/memory.ts';
import { completeJson, DEFAULT_MODEL, guessCost } from '#lib/server/openrouter.ts';
import { inBackground } from '#lib/server/ai-lane.ts';
import { listenRules, type Bought, type EventKind } from '#lib/server/rule-events.ts';
import { familySatellites, sayOnSatellites } from '#lib/server/satellites.ts';
import { inQuietHours } from '#lib/server/voice/quiet-check.ts';
import { parseClock } from 'comun/clock.ts';
import { listPlannedTrips } from '#lib/server/trips/planned.ts';
import { hasWords } from '#lib/server/voice/learned.ts';
import {
	awayOn,
	conditionsHold,
	dueIn,
	fits,
	boughtWhy,
	fittingAll,
	LATE_MINUTES,
	matchKey,
	pastItsMoment,
	MAX_CHAIN,
	minutesOf,
	momentOf,
	sameName,
	weatherFor,
	waitsFor,
	plugFits,
	plugWhy,
	type Fitted,
	type PlugHappened,
	type Rule,
	type Trip,
	type World
} from '#lib/server/rule-check.ts';
import { DRAFT_ID, simulate, withIfs, type Deduced, type WhatIf } from '#lib/server/rule-sim.ts';
import { voiceSettings } from '#lib/server/voice/settings.ts';
import { solarState } from '#lib/server/energy/solar.ts';
import { PlugOffline } from '#lib/server/plugs/hub.ts';
import { plugsOf, switchIn } from '#lib/server/plugs/plugs.ts';
import { sensorsIn } from '#lib/server/plugs/sensors.ts';
import { PLUG_KINDS } from '#lib/plugs.ts';
import {
	MAX_PLUG_MIN,
	MAX_RULE,
	plugSaid,
	ruleSaid,
	RULE_SCHEMA,
	specOf,
	timerSaid,
	type RulePlug,
	type RuleSpec,
	type TranslatedRule
} from '#lib/rules.ts';

export { sameName, type Rule };

/**
 * The family's rules (#331, phases 2 and 3): said by voice or written in Ajustes, understood by
 * the AI once (`translateRule`), and then checked by the server itself, without it. Each one is
 * looked at when something happens (a post-it, something remembered: `onEvent`, through
 * rule-events.ts) or by the clock (an agenda event, a trip, a time of day, a dose not marked:
 * `checkTimedRules`, every minute; the weather, every half hour); if what it needs holds, it tells
 * whom it says in their «Buzón» and on their phones (inbox.ts), with why. Each time once
 * (`fired`). What its words do not find is asked by its meaning (`fits`): of OpenRouter, or of
 * the house's Ollama if it fails. A person's, only theirs, as their memory; the house's,
 * everyone's. Whether they hold, in rule-check.ts, in a «world» (#389): here the real one, now;
 * and `simulateRules`, «¿Qué pasaría…?» in Ajustes, a moment to come, with nothing told.
 */

const capital = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** More than this and none is added: a family's rules, not a program. */
const MAX_RULES = 100;
/** What it was told for, kept to tell it once: the last few. */
const KEEP_FIRED = 50;

const COLUMNS = {
	id: rule.id,
	userId: rule.userId,
	said: rule.said,
	understood: rule.understood,
	spec: rule.spec,
	paused: rule.paused,
	lastFiredAt: rule.lastFiredAt,
	lastWhy: rule.lastWhy,
	fired: rule.fired,
	matches: rule.matches
};

/** The house's, and this person's if any: never another's. */
const visibleTo = (userId: string | null) =>
	userId ? or(isNull(rule.userId), eq(rule.userId, userId)) : isNull(rule.userId);

/** What `userId` may see (null, a satellite: only the house's), newest first. */
export function listRules(k: Kitchen, userId: string | null): Promise<Rule[]> {
	return k.run((tx) =>
		tx
			.select(COLUMNS)
			.from(rule)
			.where(and(eq(rule.familyId, k.familyId), visibleTo(userId)))
			.orderBy(desc(rule.createdAt))
	);
}

/** Every one of the family: the clock's and the events'. */
function allRules(k: Kitchen): Promise<Rule[]> {
	return k.run((tx) => tx.select(COLUMNS).from(rule).where(eq(rule.familyId, k.familyId)));
}

/**
 * New, for `userId` (null, the house); or, with `id`, one they see said again: told afresh. Its
 * id; null if there are too many, or `id` is not one they see.
 */
export async function saveRule(
	k: Kitchen,
	userId: string | null,
	said: string,
	understood: string,
	spec: RuleSpec,
	id: number | null = null
) {
	const values = {
		said: said.trim().slice(0, MAX_RULE),
		understood: understood.trim().slice(0, MAX_RULE),
		spec,
		paused: false,
		fired: [],
		lastFiredAt: null,
		lastWhy: null,
		matches: {},
		updatedAt: new Date()
	};
	return k.run(async (tx) => {
		if (id !== null) {
			const [row] = await tx
				.update(rule)
				.set(values)
				.where(and(eq(rule.familyId, k.familyId), eq(rule.id, id), visibleTo(userId)))
				.returning({ id: rule.id });
			return row?.id ?? null;
		}
		const [{ n } = { n: 0 }] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(rule)
			.where(eq(rule.familyId, k.familyId));
		if (n >= MAX_RULES) return null;
		const [row] = await tx
			.insert(rule)
			.values({ familyId: k.familyId, userId, ...values })
			.returning({ id: rule.id });
		return row!.id;
	});
}

/** «Pausar» or «Seguir», if they see it. */
export async function setRulePaused(
	k: Kitchen,
	userId: string | null,
	id: number,
	paused: boolean
) {
	await k.run((tx) =>
		tx
			.update(rule)
			.set({ paused, updatedAt: new Date() })
			.where(and(eq(rule.familyId, k.familyId), eq(rule.id, id), visibleTo(userId)))
	);
}

/** Gone, if they see it. What it said; null if none. */
export async function deleteRule(k: Kitchen, userId: string | null, id: number) {
	const [gone] = await k.run((tx) =>
		tx
			.delete(rule)
			.where(and(eq(rule.familyId, k.familyId), eq(rule.id, id), visibleTo(userId)))
			.returning({ understood: rule.understood })
	);
	return gone?.understood ?? null;
}

// ——— Errands (#557, phase 3) ———

/** Done or missed errands go after this many days: a list, not an archive (and MAX_RULES). */
const ERRAND_KEEP_DAYS = 7;

const isErrand = (r: Pick<Rule, 'spec'>) => r.spec.when.kind === 'en_fecha';
const momentKey = (r: Pick<Rule, 'spec'>) => `${r.spec.when.day} ${r.spec.when.time}`;

/** The errands `userId` sees (null, a satellite: the house's): the coming ones first, by their moment. */
export async function listErrands(k: Kitchen, userId: string | null) {
	const errands = (await listRules(k, userId)).filter(isErrand);
	const coming = errands
		.filter((r) => !r.paused)
		.sort((a, b) => (momentKey(a) < momentKey(b) ? -1 : 1));
	const past = errands
		.filter((r) => r.paused)
		.sort((a, b) => (momentKey(a) < momentKey(b) ? 1 : -1));
	return { coming, past };
}

/** The errands in words, for the voice and Preguntar: each with its number. */
export async function describeErrands(k: Kitchen, userId: string | null) {
	const { coming, past } = await listErrands(k, userId);
	const line = (r: Rule) => `${r.id}: ${ruleSaid(r)}`;
	const done = (r: Rule) =>
		`${line(r)} (${r.lastFiredAt ? `hecho: ${r.lastWhy ?? ''}` : `no se hizo: ${r.lastWhy ?? ''}`})`;
	return [
		coming.length
			? `Encargos pendientes: ${coming.map(line).join(' · ')}`
			: 'No hay encargos pendientes.',
		past.length ? `Últimos hechos o pasados: ${past.slice(0, 5).map(done).join(' · ')}` : ''
	]
		.filter(Boolean)
		.join('\n');
}

/**
 * An errand moved to another day or time, if they see it and it is to come or it can come again:
 * waiting afresh. Its sentence carries no day nor time (`ruleSaid`), so the AI is not asked. Why
 * not, or null.
 */
export async function moveErrand(
	k: Kitchen,
	userId: string | null,
	id: number,
	day: string,
	time: string
) {
	const r = (await listRules(k, userId)).find((x) => x.id === id);
	if (!r || !isErrand(r)) return 'No hay ese encargo.';
	if (!parseClock(time) || !/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)))
		return 'Falta el día (AAAA-MM-DD) o la hora (HH:MM).';
	if (`${day} ${time}` < `${localDay()} ${localTime()}`) return 'Esa hora ya ha pasado.';
	const spec: RuleSpec = { ...r.spec, when: { ...r.spec.when, day, time } };
	await k.run((tx) =>
		tx
			.update(rule)
			.set({
				spec,
				paused: false,
				fired: [],
				lastFiredAt: null,
				lastWhy: null,
				updatedAt: new Date()
			})
			.where(and(eq(rule.familyId, k.familyId), eq(rule.id, id), visibleTo(userId)))
	);
	return null;
}

/** Done or missed errands over `ERRAND_KEEP_DAYS` days ago, gone: from the clock's look, each minute. */
async function forgetOldErrands(k: Kitchen, rules: Rule[]) {
	const before = addDays(localDay(), -ERRAND_KEEP_DAYS);
	const old = rules.filter((r) => isErrand(r) && r.paused && (r.spec.when.day ?? '') < before);
	for (const r of old)
		await k.run((tx) => tx.delete(rule).where(and(eq(rule.id, r.id), eq(rule.paused, true))));
}

// ——— Understanding it ———

const SYSTEM = (
	today: string,
	now: string,
	people: string[],
	who: string,
	plugs: string[],
	sensors: string[]
) =>
	`Conviertes una regla de una familia, dicha en español, en datos que un programa comprueba solo, sin IA. Hoy es ${dayName(today, true)} (${today}), son las ${now}. La familia: ${people.join(', ') || 'nadie más'}. ${who}
Enchufes de la familia (Enchufes): ${plugs.join(', ') || 'ninguno'}.
Sensores de temperatura de la familia: ${sensors.join(', ') || 'ninguno'}.

Cuándo se mira («when.kind»), solo una:
- «agenda»: cuando empieza una cita de la Agenda cuyo título tiene «words» («cuando vengan mis padres» → ["padres"]); «minutes_before» antes (0, al empezar; «la víspera», 1440).
- «nevera»: cuando alguien pone un post-it o algo en la lista de la compra con «words» (vacío: cualquiera).
- «recuerdo»: cuando alguien le pide a la voz recordar algo con «words».
- «viaje_empieza» / «viaje_acaba»: cuando empieza o acaba un viaje de Viajes (de quien habla; de la casa, cualquiera); «minutes_before» antes.
- «cada_dia»: todos los días a la hora «time» (HH:MM).
- «en_fecha»: un día concreto, una sola vez, a la hora «time» (HH:MM): «mañana a las 9», «el viernes a las 15:00», «hoy a las 8 de la tarde» (20:00); «day», ese día como YYYY-MM-DD, calculado desde hoy. Sin hora clara, «possible» false. «day» es null en los demás.
- «tiempo»: cuando el tiempo de «weather» empieza a cumplirse (se mira cada media hora; avisa una vez, y otra si deja de cumplirse y vuelve, o al día siguiente): «si va a llover esta tarde, avísame para recoger la ropa».
- «dicho»: cuando alguien le dice a la voz algo con «words» («cuando diga que pongo la lavadora» → ["lavadora"]), sea la orden que sea; solo por esas palabras.
- «toma_sin_marcar»: cuando una toma de Medicación sigue sin marcar «minutes_after» minutos después de su hora (0: media hora); «words», el nombre de la persona que la toma (vacío: cualquiera).
- «compra»: cuando se guarda en Gastos una compra (un ticket, una factura, un gasto dicho) con algo de «words» («si compro bebida» → ["bebida"]; «words», lo comprado en una o dos palabras, sin «comprar»); se mira una vez por compra.
- «enchufe»: cuando un aparato enchufado a un enchufe de Enchufes empieza o acaba de funcionar (un lavado, no un momento): «plug» «empieza» o «termina» («cuando acabe la lavadora», «cuando la lavadora termine» → «termina»; «cuando ponga la lavadora», «cuando arranque» → «empieza»; sin decirlo, «termina»); «words», el aparato en una palabra («lavadora», «lavavajillas», «secadora»; vacío: cualquiera). «plug» es «ninguno» en los demás.
«words» son pocas palabras clave sueltas, tal como se escribirían en la cita o la nota, sin artículos; «time» es null salvo en «cada_dia».
«weather» (en «when» y en cada condición; «what» «ninguno» si no hace falta): «what» es «lluvia», «helada», «calor», «viento» o «nieve»; «hours», las próximas horas que mirar («esta tarde» desde ahora, «mañana» hasta mañana por la noche); «threshold», el número si lo dice (lluvia en %, 60 si no; helada y calor en °C, 0 y 35 si no; viento en km/h, 50 si no; nieve, null) o null; «where», «casa» o «donde_este» (donde esté quien habla si está de viaje: «si en Lisboa llueve»).

Qué tiene que cumplirse además («conditions», puede estar vacío), cada una con «negate» para lo contrario:
- «de_viaje»: estar de viaje hoy según Viajes («si estoy fuera», «mientras estoy de viaje»).
- «recuerdo»: que la voz recuerde algo con «words».
- «nevera»: que haya en la nevera un post-it o algo en la lista con «words».
- «agenda_hoy»: que haya hoy en la Agenda algo con «words».
- «tiempo»: que en las próximas horas haga el tiempo de su «weather» («si mañana hiela»).
- «placas»: lo que harán las placas solares de la familia según Energía → Previsión, en «solar»: «sobra_sol» (hoy, en las horas que quedan, sobra sol de las placas: buen momento para la lavadora o el termo), «bateria_no_llega» (esta noche la batería se acaba antes de que salga el sol) o «poco_sol_manana» (mañana darán menos de la mitad que hoy). «solar» es «ninguno» en las demás condiciones.
- «temperatura»: la temperatura que mide ahora un sensor de casa (arriba), en «temperature»: «sensor», su nombre exactamente como está en la lista si dice la habitación («en el dormitorio»), o «casa» si dice la casa o no dice dónde; «compare», «menos_de» o «mas_de»; «degrees», los grados («si en casa hay menos de 15 grados» → {"sensor": "casa", "compare": "menos_de", "degrees": 15}; «si hace frío en casa», menos de 18; «si hace calor en casa», más de 26). Si no hay sensores, «possible» false. En las demás condiciones, {"sensor": "", "compare": "ninguno", "degrees": 0}.

Qué hace («then»): «avisar» (con «notice»), «temporizador», «enchufe» o «deducir»: guardar un dato que luego sirve a otras reglas, sin avisar a nadie («si pongo la lavadora, ese día hay ropa tendida» → «deduce»: {"text": "Hay ropa tendida", "days": 0}). «deduce.text», el dato en una frase que se entienda sola, sin fechas; «deduce.days», cuántos días más vale (0, solo ese día; en «compra», 7 si no lo dice). Si la regla dice que es probable («probablemente», «seguramente»), el dato también: «Probablemente hay bebida en la nevera». Sin deducir, «deduce» {"text": "", "days": 0}.
«temporizador»: pone un temporizador de la casa que suena en toda la casa al acabar, cuando la regla pide esperar un rato después de lo que pasa («una hora después», «a los 20 minutos», «ponme un temporizador»): «timer.minutes», cuántos minutos; «timer.label», para qué, corto y como se diría al sonar («Sacar las bebidas del congelador»). «notice.text» vacío y «say» false: el temporizador ya suena. Sin temporizador, «timer» {"minutes": 0, "label": ""}.
«enchufe»: enciende o apaga uno de los enchufes de la familia (arriba) cuando llega su momento: «a las 9 pon el termo una hora», «mañana a las 7 apaga la tele». «plug_switch.plug», su nombre exactamente como está en la lista (el que se entiende: «el termo» → el del termo); «on», true para encender y false para apagar; «minutes», cuánto rato y luego vuelve como estaba («una hora», 60; «media hora», 30), como mucho ${MAX_PLUG_MIN}, o 0 si no lo dice (se queda así). Si no hay un enchufe que encaje, «possible» false. «notice.to» como al avisar (a quién decirle si no se puede), «notice.text» vacío y «say» false. Sin enchufe, «plug_switch» {"plug": "", "on": false, "minutes": 0}.
A quién y qué («notice», al avisar; al deducir, «text» vacío): «to» es «yo» (quien habla; en la casa, toda la familia), «casa» (toda la familia) o «personas» con sus nombres en «people», de los de la familia. «text» es el aviso tal como lo leerá quien lo recibe, corto y en segunda persona («Recuérdales a tus padres que rieguen las plantas»). «level» es «urgente» solo si lo pide o es un peligro.
«once»: true si es para una sola vez («la próxima vez que…», «este viernes»; «en_fecha», siempre).
«say»: true si además hay que decirlo en voz alta en casa, por los altavoces de la voz: si lo pide («dímelo en voz alta», «avisa en casa», «que lo diga Alexa») o si es de toda la casa; false si es solo para el móvil de quien habla.
«understood»: la regla en una frase, como la comprobará el programa, para leérsela a quien la dijo («Cuando empiece en la Agenda algo con «padres», si estás de viaje, te avisaré: …»). En «en_fecha», sin el día ni la hora, que el programa pone delante y se pueden cambiar luego: «Si en casa hay menos de 15 °C, encenderé «Termo» 1 hora».
Si no se puede con esto (otra familia, otros aparatos que no sean los enchufes y los sensores de temperatura, algo sin cuándo), «possible» false y en «why_not» por qué, corto; lo demás, lo más parecido posible.`;

/**
 * What was said, understood by the AI as a rule the server can check: its sentence and its data,
 * or why not. `who`: the person who said it (null, a satellite: the house's).
 */
export async function translateRule(
	k: Kitchen,
	said: string,
	who: string | null
): Promise<{ spec: RuleSpec; understood: string } | { problem: string }> {
	const text = said.trim().slice(0, MAX_RULE);
	if (!text) return { problem: 'Falta la regla.' };
	const [apiKey, settings, people, plugs, sensors] = await Promise.all([
		openRouterKey(k),
		voiceSettings(k),
		familyPeople(k),
		plugsOf(k),
		k.run((tx) => sensorsIn(tx, new Date(), false))
	]);
	if (!apiKey)
		return { problem: 'Sin la clave de OpenRouter de la familia no sé entender reglas.' };
	const accounts = people.filter((p) => p.userId);
	let t: TranslatedRule;
	try {
		t = await completeJson<TranslatedRule>({
			apiKey,
			label: 'Entender una regla',
			system: SYSTEM(
				localDay(),
				localTime(),
				people.map((p) => p.name),
				who ? `Quien habla es ${who}.` : 'Se dice en un satélite: es una regla de la casa.',
				plugs.map((p) => `${p.name} (${PLUG_KINDS[p.kind].label.toLowerCase()})`),
				sensors.map((s) => (s.home && sensors.length > 1 ? `${s.name} (el de casa)` : s.name))
			),
			prompt: text,
			name: 'rule',
			schema: RULE_SCHEMA,
			model: settings.model,
			maxTokens: 1_500,
			timeoutMs: 30_000
		});
	} catch (error) {
		return {
			problem: `No he podido entenderla: ${error instanceof Error ? error.message : error}`
		};
	}
	const made = specOf(
		t,
		(name) => {
			const p = accounts.find((a) => sameName(a.name, name));
			return p ? { userId: p.userId!, name: p.name } : null;
		},
		{ plugs, sensors, now: { day: localDay(), time: localTime() } }
	);
	return 'problem' in made ? made : { spec: made.spec, understood: t.understood || text };
}

/**
 * About what understanding a rule costs, in dollars, with the family's model: the instructions and
 * a rule of `chars` letters, and its answer. Null if OpenRouter's prices cannot be read.
 */
export async function translateCost(k: Kitchen, chars = 150) {
	const [settings, people] = await Promise.all([voiceSettings(k), familyPeople(k)]);
	const system = SYSTEM(
		localDay(),
		localTime(),
		people.map((p) => p.name),
		'',
		[],
		[]
	);
	return guessCost(settings.model, system.length + chars, 450);
}

// ——— Checking it, in the real world ———

/** Whose kitchen a rule is looked at in: its person's (their private trips and memory), or the house's. */
async function kitchenFor(familyId: string, userId: string | null) {
	return userId ? kitchenOf(userId) : houseKitchen(familyId);
}

/** Trips of a rule's person (the house's: everyone's), with their first and last leg. */
async function tripsFor(k: Kitchen, userId: string | null): Promise<Trip[]> {
	const [trips, me] = await Promise.all([listPlannedTrips(k), userId ? personOf(k, userId) : null]);
	return trips
		.filter((t) => t.legs.length && (!userId || !t.people.length || (me && t.people.includes(me))))
		.map((t) => ({ trip: t, first: t.legs[0]!, last: t.legs.at(-1)! }));
}

// ——— By its meaning (phase 3) ———

const WHAT: Record<Fitted, string> = {
	agenda: 'Cita de la Agenda',
	nevera: 'En la nevera',
	recuerdo: 'Lo que se pide recordar',
	compra: 'Línea de un ticket de compra, con su tipo entre paréntesis'
};
/** The house's Ollama not answering either: not asked again for a while (the clock looks every minute). */
const HOUSE_AGAIN_MS = 10 * 60_000;
const houseQuiet = new Map<string, number>();
/** Its first question loads the model: a few seconds more. */
const HOUSE_MS = 30_000;
/** What its words did not find, kept with its answer: the last few. */
const KEEP_MATCHES = 200;
/** Its answer, at most, in tokens. */
const MATCH_TOKENS = 200;

const MATCH_SYSTEM =
	'Dices si algo que ha pasado en una familia es lo que espera una de sus reglas. Solo true si es claramente eso (sinónimos, formas de decirlo, quién es quién); si dudas, false. En «porque», muy corto, por qué.';
const MATCH_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['encaja', 'porque'],
	properties: { encaja: { type: 'boolean' }, porque: { type: 'string' } }
};
const matchPrompt = (r: Rule, kind: Fitted, text: string) =>
	`Regla: «${r.said}».\n${WHAT[kind]}: «${text}».\n¿Es lo que espera la regla?`;

/**
 * By its meaning, what its words did not find: kept in `matches` from before, or asked now and
 * kept (a rule not saved, only for this time).
 */
async function keptOrAsked(k: Kitchen, r: Rule, kind: Fitted, text: string) {
	const key = matchKey(kind, text);
	const kept = r.matches[key] ?? (await askMeaning(k, r, kind, text));
	if (!kept || r.matches[key]) return kept;
	const matches = Object.fromEntries(
		[...Object.entries(r.matches), [key, kept] as const].slice(-KEEP_MATCHES)
	);
	r.matches = matches;
	if (r.id !== DRAFT_ID)
		await k.run((tx) => tx.update(rule).set({ matches }).where(eq(rule.id, r.id)));
	return kept;
}

/** At most this many lines asked in one question: a long ticket's. */
const MAX_ASKED = 60;
const MANY_SYSTEM =
	'Dices cuáles de las líneas de un ticket de compra son lo que espera una de las reglas de una familia. Cada línea lleva su tipo entre paréntesis. Solo las que claramente lo son (marcas, abreviaturas de ticket, sinónimos); si dudas, no. En «porque», muy corto, por qué.';
const MANY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['encajan'],
	properties: {
		encajan: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				required: ['n', 'porque'],
				properties: { n: { type: 'integer' }, porque: { type: 'string' } }
			}
		}
	}
};
const manyPrompt = (r: Rule, kind: Fitted, texts: string[]) =>
	`Regla: «${r.said}».\n${WHAT[kind]}, numeradas:\n${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n¿Cuáles son lo que espera la regla? Sus números.`;

/**
 * Several by their meaning (a purchase's lines, #451): those kept in `matches`, and the rest asked
 * of OpenRouter in one question and kept, each as `keptOrAsked` would. Without OpenRouter, or if it
 * fails, one by one (the house's Ollama). In their order.
 */
async function keptOrAskedMany(k: Kitchen, r: Rule, kind: Fitted, texts: string[]) {
	const answers = texts.map((t) => r.matches[matchKey(kind, t)] ?? null);
	const unknown = texts.map((t, i) => ({ t, i })).filter((x) => !answers[x.i]);
	if (!unknown.length) return answers;
	const apiKey = await openRouterKey(k);
	const asked = unknown.slice(0, MAX_ASKED);
	let got: { encajan: { n: number; porque: string }[] } | null = null;
	if (apiKey)
		try {
			got = await inBackground(() =>
				completeJson<{ encajan: { n: number; porque: string }[] }>({
					apiKey,
					label: 'Encajar una regla',
					system: MANY_SYSTEM,
					prompt: manyPrompt(
						r,
						kind,
						asked.map((x) => x.t)
					),
					name: 'matches',
					schema: MANY_SCHEMA,
					maxTokens: MATCH_TOKENS + 40 * asked.length,
					timeoutMs: 30_000
				})
			);
		} catch (error) {
			console.warn('[reglas] OpenRouter no contesta: una a una', { error: String(error) });
		}
	if (!got) {
		for (const x of asked) answers[x.i] = await keptOrAsked(k, r, kind, x.t);
		return answers;
	}
	const fit = new Map(
		(Array.isArray(got.encajan) ? got.encajan : []).map((e) => [
			Number(e.n),
			String(e.porque ?? '').slice(0, 200)
		])
	);
	const kept = { ...r.matches };
	asked.forEach((x, j) => {
		const why = fit.get(j + 1);
		const answer = { ok: why !== undefined, why: why ?? '' };
		answers[x.i] = answer;
		delete kept[matchKey(kind, x.t)];
		kept[matchKey(kind, x.t)] = answer;
	});
	r.matches = Object.fromEntries(Object.entries(kept).slice(-KEEP_MATCHES));
	if (r.id !== DRAFT_ID)
		await k.run((tx) => tx.update(rule).set({ matches: r.matches }).where(eq(rule.id, r.id)));
	return answers;
}

/**
 * Its meaning asked: of the family's AI in OpenRouter first; if it fails (or there is no key) and
 * the family has a house, of its Ollama; null if neither answers.
 */
async function askMeaning(k: Kitchen, r: Rule, kind: Fitted, text: string) {
	const question = { rule: r.said, item: text, what: WHAT[kind] };
	const apiKey = await openRouterKey(k);
	if (apiKey)
		try {
			// Behind the voice: never taking its room in OpenRouter (ai-lane.ts).
			const a = await inBackground(() =>
				completeJson<{ encaja: boolean; porque: string }>({
					apiKey,
					label: 'Encajar una regla',
					system: MATCH_SYSTEM,
					prompt: matchPrompt(r, kind, text),
					name: 'match',
					schema: MATCH_SCHEMA,
					maxTokens: MATCH_TOKENS,
					timeoutMs: 20_000
				})
			);
			return { ok: a.encaja === true, why: String(a.porque ?? '').slice(0, 200) };
		} catch (error) {
			console.warn('[reglas] OpenRouter no contesta: al salón', { error: String(error) });
		}
	if ((houseQuiet.get(k.familyId) ?? 0) >= Date.now() || !(await familyHasHouse(k.familyId)))
		return null;
	try {
		const a = await sendHouse<{ matches: boolean; why: string }>(
			k.familyId,
			'/reglas/encaja',
			{ method: 'POST', body: JSON.stringify(question) },
			HOUSE_MS
		);
		return { ok: a.matches === true, why: String(a.why ?? '').slice(0, 200) };
	} catch (error) {
		houseQuiet.set(k.familyId, Date.now() + HOUSE_AGAIN_MS);
		console.info('[reglas] El salón tampoco contesta: por las palabras', { error: String(error) });
		return null;
	}
}

/** Open-Meteo's next hours, kept a while for each place: rules look every half hour. */
const WEATHER_MS = 20 * 60_000;
const forecasts = new Map<string, { at: number; hours: Promise<HourAhead[]> }>();

function forecastAt(lat: number, lon: number) {
	const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
	const kept = forecasts.get(key);
	if (kept && Date.now() - kept.at < WEATHER_MS) return kept.hours;
	const hours = hoursAhead(lat, lon, 72).catch((error) => {
		forecasts.delete(key);
		throw error;
	});
	forecasts.set(key, { at: Date.now(), hours });
	return hours;
}

/**
 * The world a family's rules are looked at in: its sources, as they are, seen from `today` at
 * `time`; with `meaning` (and `meanings`, several at once), what its words do not find asked so
 * (by default, kept or asked and kept); with `deduced`, what a simulation deduced, remembered too.
 */
function worldOf(
	familyId: string,
	at: Pick<World, 'today' | 'time' | 'from' | 'to'>,
	{
		meaning,
		meanings,
		deduced = []
	}: {
		meaning?: World['meaning'];
		meanings?: World['meanings'];
		deduced?: readonly Deduced[];
	} = {}
): World {
	const kitchens = new Map<string, Promise<Kitchen>>();
	const kitchen = (r: Rule) => {
		const key = r.userId ?? '';
		if (!kitchens.has(key)) kitchens.set(key, kitchenFor(familyId, r.userId));
		return kitchens.get(key)!;
	};
	return {
		...at,
		trips: async (r) => tripsFor(await kitchen(r), r.userId),
		memories: async (r) => [
			...deduced.filter((d) => !d.userId || d.userId === r.userId),
			...(await listMemories(await kitchen(r), r.userId, false, at.today))
		],
		fridge: async (r) => {
			const fridge = await fridgeState(await kitchen(r));
			return [
				...fridge.notes.map((n) => n.text),
				...fridge.list.items.filter((i) => !i.done).map((i) => i.text)
			];
		},
		agenda: async (r, from, to) => (await agendaBetween(await kitchen(r), from, to)).occurrences,
		doses: async (r, day) => {
			const k = await kitchen(r);
			const [meds, people] = await Promise.all([listMedication(k), agendaPeople(k)]);
			return (await dosesFor(k, meds, day)).map((d) => ({
				time: d.time,
				name: d.name,
				personId: d.personId,
				who: people.find((p) => p.id === d.personId)?.name ?? '',
				taken: Boolean(d.takenAt)
			}));
		},
		home: async (r) => familyPlace(await kitchen(r)),
		solar: async (r) => {
			const s = await solarState(await kitchen(r));
			if (!s) return null;
			if (s.forecast === null) return 'no sé dónde vivís (Ajustes → «Dónde vivís»)';
			if (typeof s.forecast === 'string') return s.forecast;
			return s.forecast.days.length
				? s.forecast.days
				: 'falta lo que gasta la casa al día (Energía → Previsión → Placas)';
		},
		sensors: async (r) => {
			const now = Date.now();
			const sensors = await (await kitchen(r)).run((tx) => sensorsIn(tx, new Date(now), false));
			return sensors.map((s) => ({
				id: s.id,
				name: s.name,
				home: s.home,
				tempC: s.tempC,
				ageMin: s.at === null ? null : Math.round((now - Date.parse(s.at)) / 60_000)
			}));
		},
		forecast: async (lat, lon, day, time) => {
			const from = `${day}T${time.slice(0, 2)}:00`;
			const hours = (await forecastAt(lat, lon)).filter((h) => h.at >= from);
			if (!hours.length) throw new Error('la previsión no llega hasta entonces');
			return hours;
		},
		meaning: meaning ?? (async (r, kind, text) => keptOrAsked(await kitchen(r), r, kind, text)),
		// With its own `meaning` and no `meanings`, one by one through it.
		meanings:
			meanings ??
			(meaning
				? undefined
				: async (r, kind, texts) => keptOrAskedMany(await kitchen(r), r, kind, texts))
	};
}

/** Now: what is due by the clock in its last hour, as a time missed is still told that long after. */
function worldNow(familyId: string) {
	const today = localDay();
	const time = localTime();
	const now = minutesOf(today, time);
	return worldOf(familyId, { today, time, from: now - LATE_MINUTES + 1, to: now });
}

// ——— Doing it ———

/** Whom a rule's notice is for: their accounts. */
async function recipients(k: Kitchen, r: Rule) {
	const { notice } = r.spec;
	return notice.to === 'personas'
		? notice.userIds
		: notice.to === 'yo' && r.userId
			? [r.userId]
			: await familyAccounts(k);
}

/** Told: once for `key` (two servers, or a minute again, tell nothing), to whom it says. */
async function fire(k: Kitchen, r: Rule, key: string, why: string, chain: number[]) {
	const fired = [...r.fired.filter((f) => f !== key), key].slice(-KEEP_FIRED);
	const [claimed] = await k.run((tx) =>
		tx
			.update(rule)
			.set({
				fired,
				lastFiredAt: new Date(),
				lastWhy: why,
				...(r.spec.once ? { paused: true } : {})
			})
			.where(
				and(
					eq(rule.id, r.id),
					eq(rule.paused, false),
					sql`not (${rule.fired} @> ${JSON.stringify([key])}::jsonb)`
				)
			)
			.returning({ id: rule.id })
	);
	if (!claimed) return false;
	if (r.spec.then === 'deducir' && r.spec.deduce) {
		await deduce(k, r, why, chain);
		return true;
	}
	if (r.spec.then === 'temporizador' && r.spec.timer) {
		const { minutes, label } = r.spec.timer;
		const name = await startTimerAt(k, 'casa', { label, seconds: minutes * 60 });
		console.info(`[reglas] «${r.understood}»: temporizador «${name}», ${minutes} min: ${why}`, {
			id: r.id
		});
		return true;
	}
	if (r.spec.then === 'enchufe' && r.spec.plug) {
		await switchFor(k, r, r.spec.plug, why);
		return true;
	}
	const { notice } = r.spec;
	const to = await recipients(k, r);
	await tell(k.familyId, to, {
		kind: 'regla',
		level: notice.level,
		title: `🔔 ${notice.text}`,
		body: `Porque ${why}.`,
		tag: `regla-${r.id}-${key}`,
		url: '/reglas',
		ttl: 6 * 3600
	});
	await sayAtHome(k, r, to);
	console.info(`[reglas] «${r.understood}»: ${why}`, { id: r.id });
	return true;
}

/**
 * A rule's plug switched (#557), with its own timer if it says for how long; what was done kept
 * with why. If it cannot (its padlock, paused, not connected, gone), whom it is for told so: they
 * counted on it.
 */
async function switchFor(k: Kitchen, r: Rule, p: RulePlug, why: string) {
	let failed: string | null;
	try {
		const done = await switchIn(k, p.plugId, p.on, p.minutes ? p.minutes * 60 : undefined);
		failed =
			done === 'locked'
				? 'tiene el candado puesto'
				: done === 'paused'
					? 'está en pausa'
					: done === 'heating'
						? 'está calentando largo tras la pausa'
						: !done
							? 'ya no está en Enchufes'
							: null;
	} catch (error) {
		failed =
			error instanceof PlugOffline
				? 'no está conectado'
				: `no ha contestado (${error instanceof Error ? error.message : error})`;
	}
	const did = failed
		? `${why}, pero no he podido: «${p.name}» ${failed}`
		: `${why}: ${plugSaid(p, ['encendido', 'apagado'])}`;
	await k.run((tx) => tx.update(rule).set({ lastWhy: did }).where(eq(rule.id, r.id)));
	console.info(`[reglas] «${r.understood}»: ${did}`, { id: r.id });
	if (!failed) {
		// What it did, to look at later (#557, phase 3): in the Buzón, not on the phone.
		await keepQuietly(k.familyId, await recipients(k, r), {
			kind: 'regla',
			level: 'normal',
			title: `🔌 ${capital(plugSaid(p, ['encendido', 'apagado']))}`,
			body: `Porque ${why}. Era para: ${ruleSaid(r)}`,
			tag: `regla-${r.id}-hecho`,
			url: '/reglas?ver=encargos',
			ttl: 6 * 3600
		});
		return;
	}
	await tell(k.familyId, await recipients(k, r), {
		kind: 'regla',
		level: 'normal',
		title: `🔌 No he podido ${p.on ? 'encender' : 'apagar'} «${p.name}»`,
		body: `«${p.name}» ${failed}. Era para: ${ruleSaid(r)}`,
		tag: `regla-${r.id}-enchufe`,
		url: '/reglas?ver=encargos',
		ttl: 6 * 3600
	});
}

/**
 * What a rule that deduces keeps (phase 4): a memory of its person (or the house's), until its days
 * are over, with why («porque han dicho «voy a poner la lavadora» a las 10:05»); and then the rules
 * waiting for memories are told, as for one said, through this one (`chain`).
 */
async function deduce(k: Kitchen, r: Rule, why: string, chain: number[]) {
	const { deduce } = r.spec;
	if (!deduce) return;
	await remember(
		k,
		r.userId,
		deduce.text,
		{ untilDay: addDays(localDay(), deduce.days) },
		{ source: 'regla', ruleId: r.id, because: `porque ${why}`, chain: [...chain, r.id] }
	);
	console.info(`[reglas] Deducido «${deduce.text}»: ${why}`, { id: r.id });
}

/**
 * Whether it goes out loud too, if it says so (the house's, unless it said not): on the family's
 * satellites, when one it is for is at home (not on a trip that day) and it is not the quiet hours
 * (an urgent one, even then). Null, not one for out loud; else the satellites, or why not.
 */
async function aloud(
	k: Kitchen,
	r: Rule,
	to: string[],
	w: World,
	away: (userId: string) => boolean = () => false
) {
	const { notice } = r.spec;
	if (!(r.spec.say ?? !r.userId)) return null;
	const [satellites, settings] = await Promise.all([
		familySatellites(k.familyId),
		voiceSettings(k)
	]);
	if (!satellites.length) return { satellites: [], why: 'no hay satélites' };
	const minute = parseClock(w.time)!;
	if (notice.level !== 'urgente' && settings.quiet && inQuietHours(settings.quiet, minute))
		return { satellites: [], why: 'son las Horas de silencio' };
	for (const userId of to)
		if (!away(userId) && !awayOn(await tripsFor(await kitchenOf(userId), userId), w.today))
			return { satellites: satellites.map((s) => s.id), why: '' };
	return { satellites: [], why: 'no hay nadie en casa' };
}

/** Out loud too, if it says so and can (`aloud`), once. */
async function sayAtHome(k: Kitchen, r: Rule, to: string[]) {
	const out = await aloud(k, r, to, worldNow(k.familyId));
	if (!out?.satellites.length) return;
	const names = r.spec.notice.to === 'personas' ? r.spec.notice.names : [];
	sayOnSatellites(
		out.satellites,
		`${names.length ? `Aviso para ${names.join(' y ')}: ` : 'Aviso: '}${r.spec.notice.text}`
	);
}

/**
 * If its conditions hold now, told (or deduced) for `key`, with `because` and them as why. `chain`:
 * the rules what happened came through (a deduction's), none twice and at most `MAX_CHAIN`.
 */
async function tryFire(
	w: World,
	k: Kitchen,
	r: Rule,
	key: string,
	because: string,
	chain: number[] = []
) {
	if (r.paused || r.fired.includes(key)) return false;
	if (chain.includes(r.id) || chain.length >= MAX_CHAIN) {
		if (chain.length) console.info('[reglas] Cadena cortada', { id: r.id, chain });
		return false;
	}
	const { ok, why, unknown } = await conditionsHold(w, r);
	if (!ok) {
		// One day at one time (#557): why not, kept, in case its moment goes by so.
		const not = `${unknown ? NOT_KNOWN : HELD_NOT}${why.join(' y ')}`;
		if (r.spec.when.kind === 'en_fecha' && r.lastWhy !== not) {
			r.lastWhy = not;
			await k.run((tx) => tx.update(rule).set({ lastWhy: not }).where(eq(rule.id, r.id)));
		}
		return false;
	}
	return fire(k, r, key, [because, ...why].join(' y '), chain);
}

/** In `lastWhy`, while its moment lasts (#557): what did not hold, or what was not known. */
const HELD_NOT = 'no se cumple: ';
const NOT_KNOWN = 'sin saber: ';

/**
 * One day at one time gone by without being done (#557): paused for good, with why (what did not
 * hold then; else, that the server could not look). Left in the list, to be seen. Not done for
 * what was not known (a sensor with no recent reading): whom it is for told, to do it by hand.
 */
async function missedMoment(k: Kitchen, r: Rule) {
	const unknown = r.lastWhy?.startsWith(NOT_KNOWN);
	const why = r.lastWhy?.startsWith(HELD_NOT)
		? r.lastWhy.slice(HELD_NOT.length)
		: unknown
			? r.lastWhy!.slice(NOT_KNOWN.length)
			: 'no se pudo mirar a su hora';
	if (unknown) {
		const p = r.spec.then === 'enchufe' ? r.spec.plug : null;
		await tell(k.familyId, await recipients(k, r), {
			kind: 'regla',
			level: 'normal',
			title: p
				? `🔌 No he ${p.on ? 'encendido' : 'apagado'} «${p.name}»`
				: `🔔 No he podido mirar: ${ruleSaid(r)}`,
			body: `${capital(why)}. Era para: ${ruleSaid(r)}${p ? ' Si quieres, hazlo desde Enchufes.' : ''}`,
			tag: `regla-${r.id}-sin-saber`,
			url: p ? '/enchufes' : '/reglas',
			ttl: 6 * 3600
		});
	}
	const [paused] = await k.run((tx) =>
		tx
			.update(rule)
			.set({ paused: true, lastWhy: why })
			.where(and(eq(rule.id, r.id), eq(rule.paused, false)))
			.returning({ id: rule.id })
	);
	// What did not hold (#557, phase 3): in the Buzón, quietly; not known was told above.
	if (paused && !unknown) {
		const p = r.spec.then === 'enchufe' ? r.spec.plug : null;
		await keepQuietly(k.familyId, await recipients(k, r), {
			kind: 'regla',
			level: 'normal',
			title: p ? `🔌 No he ${p.on ? 'encendido' : 'apagado'} «${p.name}»` : '🔔 No ha hecho falta',
			body: `${capital(why)}. Era para: ${ruleSaid(r)}`,
			tag: `regla-${r.id}-no-hecho`,
			url: '/reglas?ver=encargos',
			ttl: 6 * 3600
		});
	}
	console.info(`[reglas] «${r.understood}»: pasó su hora sin hacerse (${why})`, { id: r.id });
}

/**
 * Something happened that rules may wait for: a post-it or something on the list (`nevera`, for
 * every rule), something remembered or deduced (`recuerdo`: a person's, only for their rules; the
 * house's, for all), something said to the voice (`dicho`: by a person, for their rules and the
 * house's; on a satellite, the house's; by its words only, as it is every order), a purchase
 * (`compra`, #451: `onPurchase`), a plug's cycle that starts or ends (`enchufe`, #528: `onPlug`).
 * From rule-events.ts, after it is saved; `chain`, the rules it came through.
 */
export async function onEvent(
	k: Kitchen,
	kind: EventKind,
	text: string,
	ownerId: string | null = null,
	chain: number[] = [],
	bought?: Bought,
	plug?: PlugHappened
) {
	if (kind === 'compra') return bought ? onPurchase(k, text, bought) : undefined;
	if (kind === 'enchufe') return plug ? onPlug(k, plug) : undefined;
	const rules = (await allRules(houseKitchen(k.familyId))).filter(
		(r) => !r.paused && r.spec.when.kind === kind && waitsFor(r, kind, ownerId)
	);
	const w = worldNow(k.familyId);
	for (const r of rules) {
		const rk = await kitchenFor(k.familyId, r.userId);
		const fit =
			kind === 'dicho'
				? { ok: hasWords(r.spec.when.words, text), why: '' }
				: await fits(w, r, r.spec.when.words, kind, text);
		if (!fit.ok) continue;
		const because =
			kind === 'nevera'
				? `han puesto en la nevera «${text}»`
				: kind === 'dicho'
					? `han dicho «${text}» a las ${w.time}`
					: `me han pedido recordar «${text}»`;
		await tryFire(w, rk, r, `${kind}:${Date.now()}`, because + fit.why, chain);
	}
}

/**
 * A purchase saved in Gastos (#451), for every rule that waits for one: told or deduced once for
 * it (not once per line), if any of its lines is what it waits for, with them in why.
 */
async function onPurchase(k: Kitchen, store: string, bought: Bought) {
	const rules = (await allRules(houseKitchen(k.familyId))).filter(
		(r) => !r.paused && r.spec.when.kind === 'compra'
	);
	if (!rules.length) return;
	const w = worldNow(k.familyId);
	for (const r of rules) {
		const found = await fittingAll(w, r, r.spec.when.words, 'compra', bought.items);
		if (!found.length) continue;
		const rk = await kitchenFor(k.familyId, r.userId);
		await tryFire(
			w,
			rk,
			r,
			`compra:${bought.expenseId}`,
			`${boughtWhy(store, found)} el ${w.today}`
		);
	}
}

/**
 * A plug's cycle that started or ended (#528), for every rule that waits for that moment of a plug
 * with its words (the family's, as Enchufes): told or deduced once for it.
 */
async function onPlug(k: Kitchen, p: PlugHappened) {
	const rules = (await allRules(houseKitchen(k.familyId))).filter(
		(r) => !r.paused && plugFits(r, p)
	);
	if (!rules.length) return;
	const w = worldNow(k.familyId);
	for (const r of rules) {
		const rk = await kitchenFor(k.familyId, r.userId);
		await tryFire(w, rk, r, `enchufe:${p.plugId}:${p.moment}:${Date.now()}`, plugWhy(p, w.time));
	}
}

listenRules(onEvent);

/** The weather a rule waits for (`tiempo`), looked at this often. */
const WEATHER_EVERY_MS = 30 * 60_000;
const weatherLooked = new Map<number, number>();
/** In `fired`: it holds now (told already); and the day it was told. */
const HOLDING = 'tiempo:se_cumple';

/**
 * A rule that waits for the weather: every half hour, told when it comes to hold (once; again if
 * it stops holding and comes back, or the next day), as long as its conditions hold too.
 */
async function checkWeather(w: World, k: Kitchen, r: Rule) {
	const weather = r.spec.when.weather;
	if (!weather || Date.now() - (weatherLooked.get(r.id) ?? 0) < WEATHER_EVERY_MS) return;
	weatherLooked.set(r.id, Date.now());
	const today = w.today;
	const { hit } = await weatherFor(w, r, weather);
	const holding = r.fired.includes(HOLDING);
	const toldToday = r.fired.includes(`tiempo:${today}`);
	if (!hit) {
		if (holding)
			await setFired(
				k,
				r,
				r.fired.filter((f) => f !== HOLDING)
			);
		return;
	}
	if (holding && toldToday) return;
	if (await tryFire(w, k, r, `tiempo:${today}:${Date.now()}`, hit)) {
		const [now] = await k.run((tx) =>
			tx.select({ fired: rule.fired }).from(rule).where(eq(rule.id, r.id))
		);
		await setFired(
			k,
			r,
			[...(now?.fired ?? []).filter((f) => f !== HOLDING), HOLDING, `tiempo:${today}`].slice(
				-KEEP_FIRED
			)
		);
	}
}

async function setFired(k: Kitchen, r: Rule, fired: string[]) {
	await k.run((tx) => tx.update(rule).set({ fired }).where(eq(rule.id, r.id)));
}

/** Every minute, for a family (scheduler.ts): the rules that wait for the clock. */
export async function checkTimedRules(familyId: string) {
	const every = await allRules(houseKitchen(familyId));
	await forgetOldErrands(houseKitchen(familyId), every);
	const rules = every.filter(
		(r) =>
			!r.paused && !['nevera', 'recuerdo', 'dicho', 'compra', 'enchufe'].includes(r.spec.when.kind)
	);
	const w = worldNow(familyId);
	const now = minutesOf(w.today, w.time);
	for (const r of rules) {
		try {
			const k = await kitchenFor(familyId, r.userId);
			if (r.spec.when.kind === 'tiempo') await checkWeather(w, k, r);
			else if (pastItsMoment(r, now)) await missedMoment(k, r);
			else for (const { key, why } of await dueIn(w, r)) await tryFire(w, k, r, key, why);
		} catch (error) {
			console.warn('[reglas] No se pudo mirar', { id: r.id, error: String(error) });
		}
	}
}

/** «Probar»: what it would do now, in a sentence (its conditions, whatever its «when»). */
export async function tryRule(k: Kitchen, userId: string | null, id: number) {
	const r = (await listRules(k, userId)).find((r) => r.id === id);
	if (!r) return null;
	const w = worldNow(k.familyId);
	const { ok, why } = await conditionsHold(w, r);
	const { weather } = r.spec.when;
	// Waiting for the weather: it is part of what has to hold now.
	if (r.spec.when.kind === 'tiempo' && weather) {
		const found = await weatherFor(w, r, weather);
		return found.hit && ok
			? `Ahora sí avisaría: ${[found.hit, ...why].join(' y ')}.`
			: `Ahora no avisaría: ${[found.hit ?? found.none, ...why].join(' y ')}.`;
	}
	const [does, will] =
		r.spec.then === 'deducir' && r.spec.deduce
			? [`deduciría «${r.spec.deduce.text}»`, `deducirá «${r.spec.deduce.text}»`]
			: r.spec.then === 'temporizador' && r.spec.timer
				? [timerSaid(r.spec.timer, 'pondría'), timerSaid(r.spec.timer, 'pondrá')]
				: r.spec.then === 'enchufe' && r.spec.plug
					? [
							plugSaid(r.spec.plug, ['encendería', 'apagaría']),
							plugSaid(r.spec.plug, ['encenderá', 'apagará'])
						]
					: ['avisaría', 'avisará'];
	if (!r.spec.conditions.length)
		return `No tiene condiciones: ${will} siempre que llegue su momento.`;
	return ok
		? `Ahora sí se cumple (${why.join(' y ')}): ${does} en cuanto llegue su momento.`
		: `Ahora no ${does}: ${why.join(' y ')}.`;
}

// ——— «¿Qué pasaría…?» (#389) ———

/** How far ahead a moment can be tried: the Agenda and the trips know, the weather 3 days. */
export const SIMULATE_DAYS = 7;
/** A rule written to try, understood once and kept a while: trying it again costs nothing. */
const DRAFT_MS = 15 * 60_000;
const drafts = new Map<string, { at: number; made: Awaited<ReturnType<typeof translateRule>> }>();

async function draftOf(k: Kitchen, who: string, said: string) {
	const key = `${k.userId}|${said.trim()}`;
	const kept = drafts.get(key);
	if (kept && Date.now() - kept.at < DRAFT_MS && !('problem' in kept.made)) return kept.made;
	const made = await translateRule(k, said, who);
	for (const [old, d] of drafts) if (Date.now() - d.at >= DRAFT_MS) drafts.delete(old);
	drafts.set(key, { at: Date.now(), made });
	return made;
}

/** «Ana, Luis y Miguel». */
const listed = (names: string[]) =>
	names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : (names[0] ?? '');

/**
 * To whom and how a notice would go then: «te avisaría en el Buzón y en el móvil, y en voz alta en
 * casa»; and, not out loud though it says so, why not.
 */
async function tellsSaid(familyId: string, r: Rule, w: World, away: (userId: string) => boolean) {
	const k = await kitchenFor(familyId, r.userId);
	const to = await recipients(k, r);
	const people = await familyPeople(k);
	const names = to.map((id) => people.find((p) => p.userId === id)?.name ?? '').filter(Boolean);
	const who =
		r.spec.notice.to === 'yo' && r.userId
			? 'te avisaría'
			: names.length
				? `avisaría a ${listed(names)}`
				: 'avisaría (a nadie con cuenta)';
	const out = await aloud(k, r, to, w, away);
	const how = `${who} en el Buzón y en el móvil${r.spec.notice.level === 'urgente' ? ' (urgente)' : ''}`;
	if (!out) return { how };
	return out.satellites.length
		? { how: `${how}, y en voz alta en casa` }
		: { how, after: `En voz alta no: ${out.why}.` };
}

export interface SimulationAsked {
	/** `YYYY-MM-DD` and `HH:MM`. */
	day: string;
	time: string;
	/** Till the end of that day; else, that hour. */
	wholeDay: boolean;
	/** A rule written to try too (not saved), and whose it would be. */
	draft: string;
	draftHouse: boolean;
	/** What only its meaning says, asked of the AI too. */
	ai: boolean;
	/** «Y si…» (phase 2). */
	ifs: WhatIf;
}

/**
 * «¿Qué pasaría…?»: the rules `userId` sees (and one written to try), on a day to come, from a
 * time: what each would do then and why, with nothing told nor kept; but for what its words do not
 * say, asked of the AI if `ai` (and its answer kept with the rule, as the server would). Else how
 * many such questions there are, and about what asking them would cost.
 */
export async function simulateRules(k: Kitchen, userId: string, who: string, o: SimulationAsked) {
	const today = localDay();
	if (o.day < today || o.day > addDays(today, SIMULATE_DAYS) || !parseClock(o.time))
		return { problem: `Elige un momento de aquí a ${SIMULATE_DAYS} días.` };
	const rules = await listRules(k, userId);
	if (o.draft.trim()) {
		const made = await draftOf(k, who, o.draft);
		if ('problem' in made) return { problem: made.problem };
		rules.unshift({
			id: DRAFT_ID,
			userId: o.draftHouse ? null : userId,
			said: o.draft.trim().slice(0, MAX_RULE),
			understood: made.understood,
			spec: made.spec,
			paused: false,
			lastFiredAt: null,
			lastWhy: null,
			fired: [],
			matches: {}
		});
	}
	if (!rules.length) return { problem: 'No hay reglas que probar: escribe una.' };
	const from = minutesOf(o.day, o.time);
	const to = o.wholeDay
		? minutesOf(o.day, '23:59')
		: Math.min(from + 59, minutesOf(o.day, '23:59'));
	/** What would be asked by its meaning, and its prompt's letters. */
	const unasked = new Map<string, number>();
	const meaning: World['meaning'] = async (r, kind, text) => {
		const key = matchKey(kind, text);
		if (r.matches[key]) return r.matches[key];
		if (o.ai) return keptOrAsked(await kitchenFor(k.familyId, r.userId), r, kind, text);
		unasked.set(`${r.id}|${key}`, MATCH_SYSTEM.length + matchPrompt(r, kind, text).length);
		return null;
	};
	// A purchase's lines, with the AI, in one question; else one by one, to count them.
	const meanings: World['meanings'] = o.ai
		? async (r, kind, texts) =>
				keptOrAskedMany(await kitchenFor(k.familyId, r.userId), r, kind, texts)
		: undefined;
	const outcomes = await simulate({
		rules,
		from,
		to,
		happens: o.ifs.happens && { ...o.ifs.happens, ownerId: userId },
		world: (minute, deduced) => {
			const then = momentOf(minute);
			return withIfs(
				worldOf(
					k.familyId,
					{ today: then.day, time: then.time, from, to },
					{ meaning, meanings, deduced }
				),
				o.ifs,
				userId
			);
		},
		tells: (r, w) => tellsSaid(k.familyId, r, w, (id) => o.ifs.away && id === userId)
	});
	let cost: number | null = 0;
	for (const letters of unasked.values()) {
		const one = await guessCost(DEFAULT_MODEL, letters, MATCH_TOKENS);
		cost = one === null || cost === null ? null : cost + one;
	}
	return { outcomes, unasked: unasked.size, cost: unasked.size ? cost : null };
}
