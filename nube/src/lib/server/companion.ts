import { desc, eq, gte, isNotNull, lt, ne } from 'drizzle-orm';
import { localTime } from 'comun/agenda.ts';
import { companion, companionCheck, familyLink, familyMember } from './db/schema.ts';
import { asFamily, withFamily } from './family.ts';
import { houseKitchen, type Kitchen } from './fridge.ts';
import { familyLinks } from './family-links.ts';
import { openRouterKey } from './family-settings.ts';
import { completeJson } from './openrouter.ts';
import { notify, type PushMessage } from './push.ts';
import { presenceOf, sayOnSatellites, unsay } from './satellite-live.ts';
import { familySatellites } from './satellites.ts';
import {
	minutesToTomorrow,
	nextStep,
	type CompanionState,
	type Presence
} from './companion-plan.ts';

/**
 * «Compañía» (#469): for someone who lives alone, now and then a satellite of theirs asks how they
 * are, in its own words (the AI's), and listens for the answer without the wake word. Answered, a
 * ✓; not, it asks again a few times and then the adults of the linked families (#464) are told,
 * until one of them says «Ya lo he mirado» or the person answers. Anything said to a satellite
 * counts as an answer too. Never at night (its hours), not while they are out («me voy», by voice,
 * or «Pausar» from a linked family), and a satellite gone is told apart: then no one can ask.
 * The linked families see only ✓ and ✗, never what was said (decided in #469).
 */

export type CompanionRow = typeof companion.$inferSelect;

export const COMPANION_LIMITS = {
	everyMinutes: { min: 15, max: 240 },
	retries: { min: 0, max: 5 },
	retryMinutes: { min: 1, max: 10 }
} as const;

/** Paused by «me voy» with no time said; at most `MAX_AWAY_MIN`, not to be forgotten for days. */
const AWAY_MIN = 3 * 60;
const MAX_AWAY_MIN = 12 * 60;
/** The history kept this long. */
const KEEP_DAYS = 60;

const tagOf = (familyId: string) => `compania:${familyId}`;
const hhmm = (d: Date) => localTime(d);
/** `time` columns come as «HH:MM:SS». */
const wall = (t: string) => t.slice(0, 5);

async function rowOf(k: Kitchen): Promise<CompanionRow | null> {
	const [row] = await k.run((tx) => tx.select().from(companion));
	return row ?? null;
}

function stateOf(row: CompanionRow): CompanionState {
	return {
		on: row.on,
		everyMinutes: row.everyMinutes,
		fromTime: wall(row.fromTime),
		toTime: wall(row.toTime),
		retries: row.retries,
		retryMinutes: row.retryMinutes,
		pausedUntil: row.pausedUntil,
		lastSignalAt: row.lastSignalAt,
		lastCheckAt: row.lastCheckAt,
		attempt: row.attempt,
		askedAt: row.askedAt,
		alertKind: row.alertKind ?? null,
		offlineSince: row.offlineSince
	};
}

const update = (k: Kitchen, set: Partial<CompanionRow>) =>
	k.run((tx) => tx.update(companion).set(set).where(eq(companion.familyId, k.familyId)));

/** The satellites that ask: those chosen that still exist, or all. */
async function askersOf(row: CompanionRow) {
	const all = (await familySatellites(row.familyId)).map((s) => s.id);
	const chosen = row.satelliteIds.filter((id) => all.includes(id));
	return chosen.length ? chosen : all;
}

async function presence(row: CompanionRow): Promise<{ presence: Presence; canAsk: string[] }> {
	const { here, canAsk } = presenceOf(await askersOf(row));
	return { presence: canAsk.length ? 'ready' : here.length ? 'old' : 'none', canAsk };
}

/** The adults of the families linked with this one, by family: whom «Compañía» tells. */
async function linkedAdults(familyId: string) {
	const links = await asFamily(familyId, (tx) =>
		tx
			.select({ from: familyLink.fromFamilyId, to: familyLink.toFamilyId })
			.from(familyLink)
			.where(isNotNull(familyLink.toFamilyId))
	);
	const others = links.map((l) => (l.from === familyId ? l.to! : l.from));
	return Promise.all(
		others.map(async (other) => ({
			familyId: other,
			userIds: (
				await asFamily(other, (tx) =>
					tx
						.select({ id: familyMember.userId })
						.from(familyMember)
						.where(ne(familyMember.role, 'peque'))
				)
			).map((m) => m.id)
		}))
	);
}

/** To every adult of the linked families, one notice per family of theirs, replaced as it goes on. */
async function tellLinked(
	familyId: string,
	message: Omit<PushMessage, 'tag' | 'url' | 'ttl'> & { ttl?: number },
	except?: string
) {
	const full: PushMessage = {
		tag: tagOf(familyId),
		url: '/compania',
		ttl: 60 * 60,
		...message
	};
	for (const linked of await linkedAdults(familyId))
		await notify(
			linked.familyId,
			linked.userIds.filter((id) => id !== except),
			full
		);
}

function alertActions(familyId: string): PushMessage['actions'] {
	return [
		{ action: 'visto', title: 'Ya lo he mirado', post: `/api/compania/visto?familia=${familyId}` },
		{ action: 'llamar', title: 'Llamar', url: '/llamadas' }
	];
}

/** A word for the time of day, for the question. */
function dayPart(now: Date) {
	const h = now.getHours();
	if (h < 7) return 'madrugada';
	if (h < 13) return 'mañana';
	if (h < 16) return 'mediodía';
	if (h < 21) return 'tarde';
	return 'noche';
}

const FIRST_QUESTIONS = [
	(n: string) => `${n}, ¿qué tal estás?`,
	(n: string) => `Hola, ${n}. ¿Cómo va todo?`,
	(n: string) => `${n}, ¿cómo te encuentras?`
];
const AGAIN = [
	(n: string) => `${n}, ¿me oyes? Contéstame, por favor.`,
	(n: string) => `${n}, ¿estás ahí? Di algo, por favor.`,
	(n: string) => `${n}, ¿va todo bien? Contéstame en voz alta.`
];
const nameOr = (row: CompanionRow) => row.name.trim() || 'Hola';

/** The first question of an asking, the AI's, varied; failing, one of ours. */
async function firstQuestion(k: Kitchen, row: CompanionRow, now: Date) {
	const name = nameOr(row);
	const ours = FIRST_QUESTIONS[now.getMinutes() % FIRST_QUESTIONS.length]!(name);
	const apiKey = await openRouterKey(k).catch(() => null);
	if (!apiKey) return ours;
	try {
		const { question } = await completeJson<{ question: string }>({
			apiKey,
			label: 'Compañía: pregunta',
			system:
				'Eres la voz de una casa y acompañas a una persona mayor que vive sola. Cada cierto tiempo le preguntas, de forma natural y cariñosa, cómo está, para saber que se encuentra bien. Escribe UNA sola pregunta corta (máximo 15 palabras), en español de España, para decirla en voz alta, que se conteste hablando. Varía: cómo está, qué hace, si ha comido, qué tal ha dormido, según la hora. Sin temas delicados, sin prisas, sin mencionar que es un control.',
			prompt: `Se llama ${row.name.trim() || '(no sabemos su nombre: sin nombre)'}. Son las ${hhmm(now)} (${dayPart(now)}).${row.question ? ` La última vez preguntaste: «${row.question}»: otra distinta.` : ''}`,
			name: 'pregunta',
			schema: {
				type: 'object',
				properties: { question: { type: 'string' } },
				required: ['question'],
				additionalProperties: false
			},
			maxTokens: 100,
			timeoutMs: 10_000
		});
		return question.trim() || ours;
	} catch (error) {
		console.warn('[compañía] Sin la pregunta de la IA: una nuestra', String(error));
		return ours;
	}
}

/** Asked on the satellites there that can ask, at once; the one before taken back. */
async function ask(k: Kitchen, row: CompanionRow, canAsk: string[], text: string) {
	unsay(tagOf(row.familyId));
	await update(k, { question: text });
	sayOnSatellites(canAsk, text, { listen: true, tag: tagOf(row.familyId) });
	console.info(`[compañía] Pregunta (intento ${row.attempt}) en ${canAsk.length} satélite(s)`, {
		familyId: row.familyId
	});
}

/** Every minute, for a family (scheduler.ts). */
export async function companionTick(familyId: string, now = new Date()) {
	const k = houseKitchen(familyId);
	const row = await rowOf(k);
	if (!row) return;
	const { presence: here, canAsk } = row.on
		? await presence(row)
		: { presence: 'none' as const, canAsk: [] };
	const step = nextStep(stateOf(row), here, now);
	const name = nameOr(row);
	switch (step) {
		case 'none':
			return;
		case 'drop':
			unsay(tagOf(familyId));
			await update(k, { attempt: 0, startedAt: null, askedAt: null });
			return;
		case 'ask': {
			const started = { ...row, attempt: 1, startedAt: now, askedAt: now };
			// Taken first: the AI may take some seconds, and the next minute must not ask again.
			await update(k, { attempt: 1, startedAt: now, askedAt: now });
			await ask(k, started, canAsk, await firstQuestion(k, row, now));
			return;
		}
		case 'retry': {
			const attempt = row.attempt + 1;
			await update(k, { attempt, askedAt: now });
			await ask(k, { ...row, attempt }, canAsk, AGAIN[(attempt - 2) % AGAIN.length]!(name));
			return;
		}
		case 'give-up': {
			unsay(tagOf(familyId));
			await k.run((tx) =>
				tx.insert(companionCheck).values({ familyId, at: row.startedAt ?? now, answered: false })
			);
			const since = row.alertKind === 'silent' && row.alertSince ? row.alertSince : row.startedAt;
			await update(k, {
				attempt: 0,
				startedAt: null,
				askedAt: null,
				lastCheckAt: now,
				alertKind: 'silent',
				alertSince: since ?? now
			});
			const again = row.alertKind === 'silent';
			console.warn(`[compañía] Sin respuesta: aviso a las familias vinculadas`, { familyId });
			await tellLinked(familyId, {
				title: `⚠️ ${row.name.trim() || 'Compañía'}: no contesta`,
				body: again
					? `Sigue sin contestar desde las ${hhmm(since ?? now)}. ¿Puedes llamar o pasarte?`
					: `No ha contestado desde las ${hhmm(since ?? now)} (${row.attempt} ${row.attempt === 1 ? 'vez' : 'veces'}). ¿Puedes llamar o pasarte?`,
				sticky: true,
				actions: alertActions(familyId)
			});
			return;
		}
		case 'offline-start':
			await update(k, { offlineSince: now });
			return;
		case 'offline-alert': {
			await update(k, { alertKind: 'offline', alertSince: row.offlineSince ?? now });
			console.warn(`[compañía] Sin satélite: aviso a las familias vinculadas (${here})`, {
				familyId
			});
			await tellLinked(familyId, {
				title: `⚠️ ${row.name.trim() || 'Compañía'}: el satélite no responde`,
				body:
					here === 'old'
						? 'Su satélite tiene que actualizarse para poder preguntarle. Hasta entonces, no se le pregunta.'
						: `Desde las ${hhmm(row.offlineSince ?? now)} no se conecta a Seilide, y sin él no se le puede preguntar. Mira si está enchufado y con internet.`,
				sticky: true,
				actions: alertActions(familyId)
			});
			return;
		}
		case 'online': {
			const told = row.alertKind === 'offline';
			await update(k, {
				offlineSince: null,
				...(told ? { alertKind: null, alertSince: null } : {})
			});
			if (told)
				await tellLinked(familyId, {
					title: `✓ ${row.name.trim() || 'Compañía'}: el satélite vuelve a funcionar`,
					body: 'Ya se le puede preguntar otra vez.'
				});
			return;
		}
	}
}

/**
 * An answer, or any sign of them: the asking going on counts as answered, and an open «no
 * contesta» is closed, telling the linked families.
 */
async function answered(k: Kitchen, row: CompanionRow, coherent: boolean | null, now = new Date()) {
	const asking = row.attempt > 0;
	if (asking) {
		unsay(tagOf(k.familyId));
		await k.run(async (tx) => {
			await tx
				.insert(companionCheck)
				.values({ familyId: k.familyId, at: now, answered: true, coherent });
			await tx
				.delete(companionCheck)
				.where(lt(companionCheck.at, new Date(now.getTime() - KEEP_DAYS * 86_400_000)));
		});
	}
	const silent = row.alertKind === 'silent';
	await update(k, {
		lastSignalAt: now,
		...(asking ? { attempt: 0, startedAt: null, askedAt: null, lastCheckAt: now } : {}),
		...(silent ? { alertKind: null, alertSince: null } : {})
	});
	if (silent) {
		console.info('[compañía] Ha contestado: aviso cerrado', { familyId: k.familyId });
		await tellLinked(k.familyId, {
			title: `✓ ${row.name.trim() || 'Compañía'}: ha contestado`,
			body: `A las ${hhmm(now)}.`
		});
	}
}

/**
 * What a satellite heard after a question (/api/satelite/compania): judged by the AI (an answer,
 * or the TV?), and what to say back. Nothing heard: nothing, the clock asks again.
 */
export async function companionAnswer(k: Kitchen, text: string): Promise<string> {
	const row = await rowOf(k);
	if (!row?.on || row.attempt === 0 || !text.trim()) return '';
	const judged = await judge(k, row, text);
	console.info(
		`[compañía] Oído tras la pregunta: ${judged.answered ? 'contesta' : 'no es una respuesta'}`,
		{ familyId: k.familyId }
	);
	if (!judged.answered) return '';
	await answered(k, row, judged.coherent);
	return judged.reply;
}

/** Whether what was heard answers the question, whether it makes sense, and what to say back. */
async function judge(k: Kitchen, row: CompanionRow, text: string) {
	const name = row.name.trim();
	// Without the AI, anyone speaking counts: better than telling everyone for nothing.
	const ours = { answered: true, coherent: null, reply: name ? `Gracias, ${name}.` : 'Gracias.' };
	const apiKey = await openRouterKey(k).catch(() => null);
	if (!apiKey) return ours;
	try {
		const out = await completeJson<{ answered: boolean; coherent: boolean; reply: string }>({
			apiKey,
			label: 'Compañía: respuesta',
			system:
				'Un satélite de voz acaba de preguntar en voz alta a una persona mayor que vive sola cómo está. Lo que oyó su micrófono después es una transcripción automática: puede tener errores, y puede ser la tele, la radio u otra conversación. answered: true si parece que una persona le contesta a la pregunta, aunque sea muy corto («sí», «bien», «aquí estoy», «déjame en paz»), o pide ayuda; false si suena a tele, radio, anuncios o a algo que no le habla a la casa. coherent: si lo que dice tiene sentido como respuesta. reply: si answered, una frase muy corta y cariñosa para contestarle (máximo 15 palabras, español de España, sin preguntas); si pide ayuda o dice que está mal, dile que avisas a su familia. Si no, vacía.',
			prompt: `${name ? `Se llama ${name}. ` : ''}Pregunta: «${row.question ?? '¿Qué tal estás?'}»\nOído después: «${text.trim()}»`,
			name: 'respuesta',
			schema: {
				type: 'object',
				properties: {
					answered: { type: 'boolean' },
					coherent: { type: 'boolean' },
					reply: { type: 'string' }
				},
				required: ['answered', 'coherent', 'reply'],
				additionalProperties: false
			},
			maxTokens: 150,
			timeoutMs: 10_000
		});
		return out;
	} catch (error) {
		console.warn('[compañía] Sin juzgar la respuesta con la IA', String(error));
		return ours;
	}
}

/**
 * Anything said to a satellite of the family (/api/voice/command): a sign of them. Back home, too:
 * a pause by «me voy» ends. Never fails the order.
 */
export async function companionHeard(familyId: string) {
	try {
		const k = houseKitchen(familyId);
		const row = await rowOf(k);
		if (!row?.on) return;
		if (row.pausedUntil && row.pausedBy === 'por voz')
			await update(k, { pausedUntil: null, pausedBy: null });
		await answered(k, row, null);
	} catch (error) {
		console.warn('[compañía] No se apuntó lo dicho', String(error));
	}
}

/** Whether the family has «Compañía» on: for the voice's `companion_away`. */
export async function companionOn(k: Kitchen) {
	return (await rowOf(k).catch(() => null))?.on ?? false;
}

/** «Me voy» (paused for a while) or «ya estoy aquí» (asked again), by voice: what was done. */
export async function companionAway(k: Kitchen, away: boolean, minutes: number | null) {
	const row = await rowOf(k);
	if (!row?.on) return 'Compañía no está puesta en esta familia.';
	if (!away) {
		await update(k, { pausedUntil: null, pausedBy: null, lastSignalAt: new Date() });
		return 'Vuelve a estar en casa: se le seguirá preguntando como siempre.';
	}
	const m = Math.min(Math.max(Math.round(minutes ?? AWAY_MIN), 15), MAX_AWAY_MIN);
	const until = new Date(Date.now() + m * 60_000);
	unsay(tagOf(k.familyId));
	await update(k, {
		pausedUntil: until,
		pausedBy: 'por voz',
		attempt: 0,
		startedAt: null,
		askedAt: null
	});
	console.info(`[compañía] Pausada por voz hasta las ${hhmm(until)}`, { familyId: k.familyId });
	return `Pausado hasta las ${hhmm(until)}: no se le pregunta mientras está fuera. Al volver, que lo diga («ya estoy aquí»), o se vuelve a preguntar a esa hora.`;
}

// ── Ajustes, in the family of the person who lives alone ──────────────────────

export interface CompanionSettings {
	on: boolean;
	name: string;
	satelliteIds: string[];
	everyMinutes: number;
	fromTime: string;
	toTime: string;
	retries: number;
	retryMinutes: number;
}

export async function companionSettings(userId: string) {
	const [row] = await withFamily(userId, (tx) => tx.select().from(companion));
	return row ? { ...row, fromTime: wall(row.fromTime), toTime: wall(row.toTime) } : null;
}

export async function saveCompanion(userId: string, s: CompanionSettings) {
	await withFamily(userId, async (tx, { familyId }) => {
		const set = { ...s, name: s.name.trim().slice(0, 40) };
		await tx
			.insert(companion)
			.values({ familyId, ...set })
			.onConflictDoUpdate({
				target: companion.familyId,
				set: { ...set, ...(s.on ? {} : { attempt: 0, startedAt: null, askedAt: null }) }
			});
	});
}

/** «Preguntar ahora», to try it: the next minute asks, within its hours. */
export async function askSoon(userId: string) {
	await withFamily(userId, (tx) =>
		tx
			.update(companion)
			.set({ lastSignalAt: null, lastCheckAt: null, pausedUntil: null, pausedBy: null })
			.where(eq(companion.attempt, 0))
	);
}

// ── What the linked families see and do (/compania, the home page) ────────────

export interface CompanionView {
	familyId: string;
	familyName: string;
	name: string;
	asking: boolean;
	lastAnswerAt: Date | null;
	paused: { until: Date; by: string | null } | null;
	alert: { kind: 'silent' | 'offline'; since: Date } | null;
	fromTime: string;
	toTime: string;
	/** Today's and yesterday's askings, newest first: ✓ or ✗ only. */
	checks: { at: Date; answered: boolean }[];
}

async function viewOf(familyId: string, familyName: string): Promise<CompanionView | null> {
	return asFamily(familyId, async (tx) => {
		const [row] = await tx.select().from(companion);
		if (!row?.on) return null;
		const since = new Date();
		since.setHours(0, 0, 0, 0);
		since.setDate(since.getDate() - 1);
		const checks = await tx
			.select({ at: companionCheck.at, answered: companionCheck.answered })
			.from(companionCheck)
			.where(gte(companionCheck.at, since))
			.orderBy(desc(companionCheck.at));
		const [lastAnswer] = await tx
			.select({ at: companionCheck.at })
			.from(companionCheck)
			.where(eq(companionCheck.answered, true))
			.orderBy(desc(companionCheck.at))
			.limit(1);
		const lastAnswerAt =
			[lastAnswer?.at, row.lastSignalAt]
				.filter((d): d is Date => Boolean(d))
				.sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
		return {
			familyId,
			familyName,
			name: row.name.trim() || familyName,
			asking: row.attempt > 0,
			lastAnswerAt,
			paused:
				row.pausedUntil && row.pausedUntil > new Date()
					? { until: row.pausedUntil, by: row.pausedBy }
					: null,
			alert: row.alertKind ? { kind: row.alertKind, since: row.alertSince ?? new Date() } : null,
			fromTime: wall(row.fromTime),
			toTime: wall(row.toTime),
			checks
		};
	});
}

/** The linked families with «Compañía» on, as this adult sees them. None for a child. */
export async function companionsFor(userId: string): Promise<CompanionView[]> {
	const linked = await familyLinks.linked(userId);
	const views = await Promise.all(linked.map((f) => viewOf(f.familyId, f.familyName)));
	return views.filter((v): v is CompanionView => v !== null);
}

/** Their own, in Ajustes: the same view. */
export async function ownCompanion(userId: string) {
	const familyId = await withFamily(userId, async (_, m) => m.familyId);
	return viewOf(familyId, '');
}

/** The family behind `familyId`, if it is linked with this adult's: its kitchen. */
async function linkedKitchen(userId: string, familyId: string) {
	const linked = await familyLinks.linked(userId);
	return linked.some((f) => f.familyId === familyId) ? houseKitchen(familyId) : null;
}

/** «Ya lo he mirado»: closed for all, and the others told who. */
export async function companionSeen(userId: string, who: string, familyId: string) {
	const k = await linkedKitchen(userId, familyId);
	if (!k) return false;
	const row = await rowOf(k);
	if (!row?.alertKind) return true;
	await update(k, { alertKind: null, alertSince: null });
	console.info('[compañía] Aviso mirado por alguien de una familia vinculada', { familyId });
	await tellLinked(
		familyId,
		{
			title: `${row.name.trim() || 'Compañía'}: lo ha mirado ${who}`,
			body: 'El aviso está cerrado.'
		},
		userId
	);
	return true;
}

export type PauseFor = '1h' | '3h' | 'manana';

/** «Pausar» from a linked family: for a while, or until tomorrow's hours. */
export async function companionPause(
	userId: string,
	who: string,
	familyId: string,
	length: PauseFor
) {
	const k = await linkedKitchen(userId, familyId);
	if (!k) return false;
	const row = await rowOf(k);
	if (!row) return false;
	const now = new Date();
	const minutes =
		length === '1h' ? 60 : length === '3h' ? 180 : minutesToTomorrow(wall(row.fromTime), now);
	unsay(tagOf(familyId));
	await update(k, {
		pausedUntil: new Date(now.getTime() + minutes * 60_000),
		pausedBy: who,
		attempt: 0,
		startedAt: null,
		askedAt: null
	});
	return true;
}

export async function companionResume(userId: string, familyId: string) {
	const k = await linkedKitchen(userId, familyId);
	if (!k) return false;
	await update(k, { pausedUntil: null, pausedBy: null });
	return true;
}

/** Whether these ids are all the family's satellites: for saving its settings. */
export async function onlyOwnSatellites(userId: string, ids: string[]) {
	const familyId = await withFamily(userId, async (_, m) => m.familyId);
	const own = new Set((await familySatellites(familyId)).map((s) => s.id));
	return ids.filter((id) => own.has(id));
}
