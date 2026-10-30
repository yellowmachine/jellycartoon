import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { addDays, dayName, localDay, localTime } from 'comun/agenda.ts';
import { fold } from 'comun/music.ts';
import { rule } from '#lib/server/db/schema.ts';
import {
	agendaBetween,
	familyAccounts,
	familyPeople,
	personOf
} from '#lib/server/agenda/agenda.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { fridgeState, houseKitchen, kitchenOf, type Kitchen } from '#lib/server/fridge.ts';
import { tell } from '#lib/server/inbox.ts';
import { listMemories } from '#lib/server/memory.ts';
import { completeJson } from '#lib/server/openrouter.ts';
import { listenRules } from '#lib/server/rule-events.ts';
import { familySatellites, sayOnSatellites } from '#lib/server/satellites.ts';
import { inQuietHours } from '#lib/server/voice/quiet-check.ts';
import { parseClock } from 'comun/clock.ts';
import { listPlannedTrips } from '#lib/server/trips/planned.ts';
import { hasWords } from '#lib/server/voice/learned.ts';
import { voiceSettings } from '#lib/server/voice/settings.ts';
import {
	MAX_RULE,
	RULE_SCHEMA,
	specOf,
	type Condition,
	type RuleSpec,
	type TranslatedRule
} from '#lib/rules.ts';

/**
 * The family's rules (#331, phase 2): said by voice or written in Ajustes, understood by the AI
 * once (`translateRule`), and then checked by the server itself, without it. Each one is looked
 * at when something happens (a post-it, something remembered: `onEvent`, through rule-events.ts)
 * or by the clock (an agenda event, a trip, a time of day: `checkTimedRules`, every minute); if
 * what it needs holds, it tells whom it says in their «Buzón» and on their phones (inbox.ts),
 * with why. Each time once (`fired`). A person's, only theirs, as their memory; the house's,
 * everyone's.
 */

/** More than this and none is added: a family's rules, not a program. */
const MAX_RULES = 100;
/** What it was told for, kept to tell it once: the last few. */
const KEEP_FIRED = 50;
/** A time missed (the server was off): still told this long after. */
const LATE_MINUTES = 60;
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
}

const COLUMNS = {
	id: rule.id,
	userId: rule.userId,
	said: rule.said,
	understood: rule.understood,
	spec: rule.spec,
	paused: rule.paused,
	lastFiredAt: rule.lastFiredAt,
	lastWhy: rule.lastWhy,
	fired: rule.fired
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

// ——— Understanding it ———

/** «Ana», «ana», «Ána», and «Ana» for Ana María: the same person. */
export const sameName = (full: string, said: string) => {
	const a = fold(full.trim());
	const b = fold(said.trim());
	return a === b || a.split(/\s+/)[0] === b;
};

const SYSTEM = (today: string, people: string[], who: string) =>
	`Conviertes una regla de una familia, dicha en español, en datos que un programa comprueba solo, sin IA. Hoy es ${dayName(today, true)} (${today}). La familia: ${people.join(', ') || 'nadie más'}. ${who}

Cuándo se mira («when.kind»), solo una:
- «agenda»: cuando empieza una cita de la Agenda cuyo título tiene «words» («cuando vengan mis padres» → ["padres"]); «minutes_before» antes (0, al empezar; «la víspera», 1440).
- «nevera»: cuando alguien pone un post-it o algo en la lista de la compra con «words» (vacío: cualquiera).
- «recuerdo»: cuando alguien le pide a la voz recordar algo con «words».
- «viaje_empieza» / «viaje_acaba»: cuando empieza o acaba un viaje de Viajes (de quien habla; de la casa, cualquiera); «minutes_before» antes.
- «cada_dia»: todos los días a la hora «time» (HH:MM).
«words» son pocas palabras clave sueltas, tal como se escribirían en la cita o la nota, sin artículos; «time» es null salvo en «cada_dia».

Qué tiene que cumplirse además («conditions», puede estar vacío), cada una con «negate» para lo contrario:
- «de_viaje»: estar de viaje hoy según Viajes («si estoy fuera», «mientras estoy de viaje»).
- «recuerdo»: que la voz recuerde algo con «words».
- «nevera»: que haya en la nevera un post-it o algo en la lista con «words».
- «agenda_hoy»: que haya hoy en la Agenda algo con «words».

A quién y qué («notice»): «to» es «yo» (quien habla; en la casa, toda la familia), «casa» (toda la familia) o «personas» con sus nombres en «people», de los de la familia. «text» es el aviso tal como lo leerá quien lo recibe, corto y en segunda persona («Recuérdales a tus padres que rieguen las plantas»). «level» es «urgente» solo si lo pide o es un peligro.
«once»: true si es para una sola vez («la próxima vez que…», «este viernes»).
«say»: true si además hay que decirlo en voz alta en casa, por los altavoces de la voz: si lo pide («dímelo en voz alta», «avisa en casa», «que lo diga Alexa») o si es de toda la casa; false si es solo para el móvil de quien habla.
«understood»: la regla en una frase, como la comprobará el programa, para leérsela a quien la dijo («Cuando empiece en la Agenda algo con «padres», si estás de viaje, te avisaré: …»).
Si no se puede con esto (otra familia, el tiempo que hará, sensores, algo sin cuándo), «possible» false y en «why_not» por qué, corto; lo demás, lo más parecido posible.`;

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
	const [apiKey, settings, people] = await Promise.all([
		openRouterKey(k),
		voiceSettings(k),
		familyPeople(k)
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
				people.map((p) => p.name),
				who ? `Quien habla es ${who}.` : 'Se dice en un satélite: es una regla de la casa.'
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
	const made = specOf(t, (name) => {
		const p = accounts.find((a) => sameName(a.name, name));
		return p ? { userId: p.userId!, name: p.name } : null;
	});
	return 'problem' in made ? made : { spec: made.spec, understood: t.understood || text };
}

// ——— Checking it ———

const quoted = (words: string[]) => words.map((w) => `«${w}»`).join(' y ');

/** Whose kitchen a rule is looked at in: its person's (their private trips and memory), or the house's. */
async function kitchenFor(familyId: string, userId: string | null) {
	return userId ? kitchenOf(userId) : houseKitchen(familyId);
}

/** Trips of a rule's person (the house's: everyone's), with their first and last leg. */
async function tripsFor(k: Kitchen, userId: string | null) {
	const [trips, me] = await Promise.all([listPlannedTrips(k), userId ? personOf(k, userId) : null]);
	return trips
		.filter((t) => t.legs.length && (!userId || !t.people.length || (me && t.people.includes(me))))
		.map((t) => ({ trip: t, first: t.legs[0]!, last: t.legs.at(-1)! }));
}

/** A condition now: whether it holds (negated already), and why in words. */
async function holds(k: Kitchen, r: Rule, c: Condition): Promise<{ ok: boolean; why: string }> {
	const today = localDay();
	const mine = Boolean(r.userId);
	let found: string | null = null;
	let none = '';
	switch (c.kind) {
		case 'de_viaje': {
			const away = (await tripsFor(k, r.userId)).find(
				(t) => t.first.day <= today && today <= t.last.day
			);
			found = away ? `${mine ? 'estás' : 'alguien está'} de viaje («${away.trip.name}»)` : null;
			none = mine ? 'no estás de viaje' : 'nadie está de viaje';
			break;
		}
		case 'recuerdo': {
			const m = (await listMemories(k, r.userId)).find((m) => hasWords(c.words, m.text));
			found = m ? `recuerdo «${m.text}»` : null;
			none = `no recuerdo nada con ${quoted(c.words)}`;
			break;
		}
		case 'nevera': {
			const fridge = await fridgeState(k);
			const texts = [
				...fridge.notes.map((n) => n.text),
				...fridge.list.items.filter((i) => !i.done).map((i) => i.text)
			];
			const t = texts.find((t) => hasWords(c.words, t));
			found = t ? `en la nevera pone «${t}»` : null;
			none = `no hay nada en la nevera con ${quoted(c.words)}`;
			break;
		}
		case 'agenda_hoy': {
			const { occurrences } = await agendaBetween(k, today, today);
			const o = occurrences.find(
				(o) => o.day <= today && today <= o.lastDay && hasWords(c.words, o.title)
			);
			found = o ? `hoy hay «${o.title}» en la Agenda` : null;
			none = `hoy no hay nada en la Agenda con ${quoted(c.words)}`;
			break;
		}
	}
	const ok = c.negate ? !found : Boolean(found);
	return { ok, why: found ?? none };
}

/** All of its conditions now: whether they hold, and why. */
async function conditionsHold(k: Kitchen, r: Rule) {
	const checked = [];
	for (const c of r.spec.conditions) checked.push(await holds(k, r, c));
	return { ok: checked.every((c) => c.ok), why: checked.map((c) => c.why) };
}

/** Told: once for `key` (two servers, or a minute again, tell nothing), to whom it says. */
async function fire(k: Kitchen, r: Rule, key: string, why: string) {
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
	const { notice } = r.spec;
	const to =
		notice.to === 'personas'
			? notice.userIds
			: notice.to === 'yo' && r.userId
				? [r.userId]
				: await familyAccounts(k);
	await tell(k.familyId, to, {
		kind: 'regla',
		level: notice.level,
		title: `🔔 ${notice.text}`,
		body: `Porque ${why}.`,
		tag: `regla-${r.id}-${key}`,
		url: '/ajustes?seccion=mi#reglas',
		ttl: 6 * 3600
	});
	await sayAtHome(k, r, to);
	console.info(`[reglas] «${r.understood}»: ${why}`, { id: r.id });
	return true;
}

/**
 * Out loud too, if it says so (the house's, unless it said not): on the family's satellites, once,
 * when one it is for is at home (not on a trip today) and it is not the quiet hours (an urgent one,
 * even then).
 */
async function sayAtHome(k: Kitchen, r: Rule, to: string[]) {
	const { notice } = r.spec;
	if (!(r.spec.say ?? !r.userId)) return;
	const [satellites, settings] = await Promise.all([
		familySatellites(k.familyId),
		voiceSettings(k)
	]);
	if (!satellites.length) return;
	const minute = parseClock(localTime())!;
	if (notice.level !== 'urgente' && settings.quiet && inQuietHours(settings.quiet, minute)) return;
	const today = localDay();
	let home = false;
	for (const userId of to) {
		const trips = await tripsFor(await kitchenOf(userId), userId);
		if (!trips.some((t) => t.first.day <= today && today <= t.last.day)) {
			home = true;
			break;
		}
	}
	if (!home) return;
	const names = notice.to === 'personas' ? notice.names : [];
	sayOnSatellites(
		satellites.map((s) => s.id),
		`${names.length ? `Aviso para ${names.join(' y ')}: ` : 'Aviso: '}${notice.text}`
	);
}

/** If its conditions hold now, told for `key`, with `because` and them as why. */
async function tryFire(k: Kitchen, r: Rule, key: string, because: string) {
	if (r.paused || r.fired.includes(key)) return false;
	const { ok, why } = await conditionsHold(k, r);
	if (!ok) return false;
	return fire(k, r, key, [because, ...why].join(' y '));
}

/**
 * Something happened that rules may wait for: a post-it or something on the list (`nevera`, for
 * every rule), something remembered (`recuerdo`: a person's, only for their rules; the house's,
 * for all). From rule-events.ts, after it is saved.
 */
export async function onEvent(
	k: Kitchen,
	kind: 'nevera' | 'recuerdo',
	text: string,
	ownerId: string | null = null
) {
	const rules = (await allRules(houseKitchen(k.familyId))).filter(
		(r) =>
			!r.paused &&
			r.spec.when.kind === kind &&
			(kind === 'nevera' || !ownerId || r.userId === ownerId) &&
			hasWords(r.spec.when.words, text)
	);
	for (const r of rules) {
		const rk = await kitchenFor(k.familyId, r.userId);
		const because =
			kind === 'nevera' ? `han puesto en la nevera «${text}»` : `me han pedido recordar «${text}»`;
		await tryFire(rk, r, `${kind}:${Date.now()}`, because);
	}
}

listenRules(onEvent);

/** `YYYY-MM-DD` and `HH:MM` as minutes, on the wall's clock: to compare and subtract. */
const minutesOf = (day: string, time: string) => {
	const [y, m, d] = day.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	return Date.UTC(y!, m! - 1, d!, hh!, mm!) / 60_000;
};

/** What it waits for by the clock, due now (or a little late): each with its key and why. */
async function dueNow(k: Kitchen, r: Rule) {
	const today = localDay();
	const now = minutesOf(today, localTime());
	const due = (day: string, time: string) => {
		const at = minutesOf(day, time) - r.spec.when.minutesBefore;
		return now >= at && now < at + LATE_MINUTES;
	};
	const { when } = r.spec;
	const found: { key: string; why: string }[] = [];
	if (when.kind === 'cada_dia' && when.time && due(today, when.time))
		found.push({ key: `cada_dia:${today}`, why: `son las ${when.time}` });
	if (when.kind === 'agenda') {
		const ahead = Math.ceil(when.minutesBefore / (24 * 60)) + 1;
		const { occurrences } = await agendaBetween(k, today, addDays(today, ahead));
		for (const o of occurrences)
			if (hasWords(when.words, o.title) && due(o.day, o.startTime ?? ALL_DAY_AT))
				found.push({
					key: `agenda:${o.eventId}:${o.day}`,
					why: `${when.minutesBefore ? 'va a empezar' : 'empieza'} «${o.title}» (${dayName(o.day)}${o.startTime ? `, ${o.startTime}` : ''})`
				});
	}
	if (when.kind === 'viaje_empieza' || when.kind === 'viaje_acaba')
		for (const { trip, first, last } of await tripsFor(k, r.userId)) {
			const leg = when.kind === 'viaje_empieza' ? first : last;
			if (when.kind === 'viaje_acaba' && first === last) continue;
			if (due(leg.day, leg.time))
				found.push({
					key: `${when.kind}:${trip.id}:${leg.day}`,
					why: `${when.kind === 'viaje_empieza' ? 'empieza' : 'acaba'} el viaje «${trip.name}»`
				});
		}
	return found;
}

/** Every minute, for a family (scheduler.ts): the rules that wait for the clock. */
export async function checkTimedRules(familyId: string) {
	const rules = (await allRules(houseKitchen(familyId))).filter(
		(r) => !r.paused && !['nevera', 'recuerdo'].includes(r.spec.when.kind)
	);
	for (const r of rules) {
		try {
			const k = await kitchenFor(familyId, r.userId);
			for (const { key, why } of await dueNow(k, r)) await tryFire(k, r, key, why);
		} catch (error) {
			console.warn('[reglas] No se pudo mirar', { id: r.id, error: String(error) });
		}
	}
}

/** «Probar»: what it would do now, in a sentence (its conditions, whatever its «when»). */
export async function tryRule(k: Kitchen, userId: string | null, id: number) {
	const r = (await listRules(k, userId)).find((r) => r.id === id);
	if (!r) return null;
	const { ok, why } = await conditionsHold(k, r);
	if (!r.spec.conditions.length)
		return 'No tiene condiciones: avisará siempre que llegue su momento.';
	return ok
		? `Ahora sí se cumple (${why.join(' y ')}): avisaría en cuanto llegue su momento.`
		: `Ahora no avisaría: ${why.join(' y ')}.`;
}
