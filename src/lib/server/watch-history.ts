import {
	and,
	asc,
	desc,
	eq,
	gt,
	gte,
	inArray,
	isNotNull,
	lte,
	min,
	sql,
	type SQL
} from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	episode,
	episodeTitle,
	movie,
	movieProgress,
	movieTitle,
	series,
	watchProgress,
	watchTime
} from '#lib/server/db/schema.ts';
import { kidRules, now, videoAllowed, watchedToday } from '#lib/server/kid-time.ts';
import type { Tool } from '#lib/server/openrouter.ts';
import { today } from '#lib/server/playlist.ts';
import { CHANNELS } from '#lib/channels.ts';
import { clock, closedText, joinSlots, SLOT_MINUTES, WEEKDAYS } from '#lib/kid-time.ts';

/**
 * What someone watched, as read-only tools for a model: in /infantil, the children's, for the
 * adults; in /voz, an adult's own. No SQL from the model: typed queries, and their results already
 * added up, so that the figures are the database's and not the model's. Whose data a tool reads is
 * never up to the model beyond the people it is given: the children, or who is asking.
 */

/** Longest period a question may cover: more than a year is not about how someone watches. */
const MAX_DAYS = 400;
/** Rows a grouping gives at most: the model summarizes, it does not list. */
const MAX_ROWS = 40;

export interface Person {
	id: string;
	name: string;
}

/** Whose history the tools read: one of these children (by `kid_id`), or who is asking. */
export type Whose = { kids: Person[] } | { self: Person };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const minutes = (seconds: number) => Math.round(seconds / 60);

/** In the server's time zone, as the rest of the app. */
const dateTime = new Intl.DateTimeFormat('es-ES', {
	weekday: 'long',
	day: 'numeric',
	month: 'long',
	hour: '2-digit',
	minute: '2-digit'
});

/** Days between two `YYYY-MM-DD`, both included. */
function daysIn(from: string, to: string) {
	return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

const fn = (name: string, description: string, properties: object, required: string[]): Tool => ({
	type: 'function',
	function: {
		name,
		description,
		parameters: { type: 'object', properties, required, additionalProperties: false }
	}
});

export const HISTORY_TOOLS = new Set(['watch_time', 'sessions', 'finished', 'halfway', 'rules']);

/** The children's, with their rules; or who is asking's, with no one to choose. */
export function historyTools(whose: Whose): Tool[] {
	const person =
		'kids' in whose
			? {
					kid_id: {
						type: 'string',
						enum: whose.kids.map((k) => k.id),
						description: 'El id de la cuenta infantil, de la lista de las instrucciones.'
					}
				}
			: {};
	const personRequired = 'kids' in whose ? ['kid_id'] : [];
	const days = {
		...person,
		from: { type: 'string', description: 'Primer día, YYYY-MM-DD, incluido.' },
		to: { type: 'string', description: 'Último día, YYYY-MM-DD, incluido.' }
	};
	const daysRequired = [...personRequired, 'from', 'to'];
	return [
		fn(
			'watch_time',
			'Tiempo de vídeo que de verdad ha avanzado (sin pausas ni saltos) entre dos días, en minutos: el total y desglosado. Para las horas, «sessions».',
			{
				...days,
				group_by: {
					type: 'string',
					enum: ['day', 'series', 'title', 'kind'],
					description:
						'«day»: por día. «series»: por serie (las películas y los canales, cada uno aparte). «title»: por episodio, película o canal. «kind»: series, películas o canales de tele en directo.'
				}
			},
			[...daysRequired, 'group_by']
		),
		fn(
			'sessions',
			`Los ratos en que se vio vídeo entre dos días, con la hora de empezar y de acabar y lo que se vio en cada uno: también qué episodio fue un día concreto. La hora va en tramos de ${SLOT_MINUTES} minutos: «de 21:10 a 21:50» es que empezó entre las 21:10 y las 21:20 y acabó entre las 21:40 y las 21:50. Los días de antes de guardar horas salen en «daysWithoutHours».`,
			days,
			daysRequired
		),
		fn(
			'finished',
			'Episodios y películas terminados entre dos días, con el día y la hora en que se terminaron.',
			days,
			daysRequired
		),
		fn(
			'halfway',
			'Lo que está a medias ahora mismo, con cuánto se lleva visto y cuándo se vio por última vez.',
			person,
			personRequired
		),
		...('kids' in whose
			? [
					fn(
						'rules',
						'Sus normas: horario por día de la semana, límite de minutos al día, si puede ver vídeos ahora, y cuánto lleva hoy.',
						person,
						personRequired
					)
				]
			: [])
	];
}

/** Since when there is anything, for each one; and since when there are hours, for any of them. */
export async function historySince(people: Person[]) {
	const ids = people.map((p) => p.id);
	if (!ids.length) return { since: new Map<string, string>(), hoursSince: null };
	const [firsts, [timed]] = await Promise.all([
		db
			.select({ userId: watchTime.userId, day: min(watchTime.day) })
			.from(watchTime)
			.where(inArray(watchTime.userId, ids))
			.groupBy(watchTime.userId),
		db
			.select({ day: min(watchTime.day) })
			.from(watchTime)
			.where(and(inArray(watchTime.userId, ids), isNotNull(watchTime.minute)))
	]);
	return {
		since: new Map(firsts.flatMap((f) => (f.day ? [[f.userId, f.day] as const] : []))),
		hoursSince: timed?.day ?? null
	};
}

/** Today and now, for «el viernes pasado»: not in cached instructions, it changes every minute. */
export function todayText() {
	const moment = now();
	return `Hoy es ${WEEKDAYS[moment.weekday]} ${today()}, son las ${clock(moment.minute)}. Las semanas empiezan en lunes.`;
}

/** How to use what the tools give, the same wherever they are. */
export function historyRules(hoursSince: string | null) {
	return [
		'- Las cifras y los títulos salen siempre de las herramientas: nunca los inventes ni los estimes. Si hace falta, llama a varias o compara dos periodos.',
		hoursSince
			? `- Las horas a las que se ve vídeo («sessions») se guardan desde el ${hoursSince}, en tramos de ${SLOT_MINUTES} minutos: di las horas con esa aproximación («sobre las nueve y diez»). De antes solo hay días; si preguntan por horas de entonces, dilo.`
			: '- Todavía no hay horas guardadas, solo días: si preguntan a qué hora se vio algo, dilo.',
		'- «Después de cenar», «antes del cole» y parecidos: si no han dicho a qué hora es eso, supón una hora razonable en España (cenar, sobre las 21:00) y di cuál has supuesto.',
		'- Minutos y horas redondeados («una hora y cuarto»), sin listas largas.'
	].join('\n');
}

const channelName = (id: string) => CHANNELS.find((c) => c.id === id)?.name ?? id;

/** Each row of watch_time, with what it was. */
function watchedRows(where: SQL | undefined) {
	return db
		.select({
			seriesTitle: series.title,
			title: sql<string>`coalesce(${movieTitle}, ${episodeTitle})`,
			season: episode.season,
			number: episode.number,
			movieId: watchTime.movieId,
			channelId: watchTime.channelId,
			day: watchTime.day,
			minute: watchTime.minute,
			seconds: watchTime.seconds
		})
		.from(watchTime)
		.leftJoin(episode, eq(episode.id, watchTime.episodeId))
		.leftJoin(series, eq(series.id, episode.seriesId))
		.leftJoin(movie, eq(movie.id, watchTime.movieId))
		.where(where);
}

type WatchedRow = Awaited<ReturnType<typeof watchedRows>>[number];

/** `bySeries`: the series, not the episode. */
function labelOf(r: WatchedRow, bySeries = false) {
	if (r.channelId) return `Canal ${channelName(r.channelId)}`;
	if (r.movieId) return `Película «${r.title}»`;
	return bySeries
		? `Serie «${r.seriesTitle}»`
		: `«${r.seriesTitle}» T${r.season} E${r.number} «${r.title}»`;
}

async function watchTimeTool(userId: string, from: string, to: string, groupBy: string) {
	const where = and(eq(watchTime.userId, userId), gte(watchTime.day, from), lte(watchTime.day, to));
	const seconds = sql<number>`sum(${watchTime.seconds})::real`;

	if (groupBy === 'day') {
		const rows = await db
			.select({ day: watchTime.day, seconds })
			.from(watchTime)
			.where(where)
			.groupBy(watchTime.day)
			.orderBy(asc(watchTime.day));
		return { rows: rows.map((r) => ({ day: r.day, minutes: minutes(r.seconds) })) };
	}
	if (groupBy === 'kind') {
		const kind = sql<string>`case when ${watchTime.episodeId} is not null then 'serie' when ${watchTime.movieId} is not null then 'película' else 'canal en directo' end`;
		const rows = await db
			.select({ kind, seconds })
			.from(watchTime)
			.where(where)
			.groupBy(kind)
			.orderBy(desc(seconds));
		return { rows: rows.map((r) => ({ kind: r.kind, minutes: minutes(r.seconds) })) };
	}

	// Added up here: few rows for a person, and the label of each group is simpler to make in code.
	const groups = new Map<string, { label: string; seconds: number; days: Set<string> }>();
	for (const r of await watchedRows(where)) {
		const label = labelOf(r, groupBy === 'series');
		const group = groups.get(label) ?? { label, seconds: 0, days: new Set() };
		group.seconds += r.seconds;
		group.days.add(r.day);
		groups.set(label, group);
	}
	const sorted = [...groups.values()].sort((a, b) => b.seconds - a.seconds);
	return {
		rows: sorted.slice(0, MAX_ROWS).map((g) => ({
			what: g.label,
			minutes: minutes(g.seconds),
			days: g.days.size
		})),
		...(sorted.length > MAX_ROWS && { more: sorted.length - MAX_ROWS })
	};
}

/** The stretches it watched, from the 10-minute slots in a row with time; days before slots, apart. */
async function sessionsTool(userId: string, from: string, to: string) {
	const rows = await watchedRows(
		and(eq(watchTime.userId, userId), gte(watchTime.day, from), lte(watchTime.day, to))
	);
	const timed = rows.flatMap((r) =>
		r.minute === null
			? []
			: [{ day: r.day, minute: r.minute, seconds: r.seconds, label: labelOf(r) }]
	);
	// Less than half a minute is a look, not watching: it would only be «0 min».
	const sessions = joinSlots(timed)
		.filter((s) => minutes(s.seconds) > 0)
		.map((s) => ({
			day: `${WEEKDAYS[weekdayOf(s.day)]} ${s.day}`,
			from: clock(s.start),
			to: clock(s.end),
			minutes: minutes(s.seconds),
			watched: [...s.items]
				.filter(([, seconds]) => minutes(seconds) > 0)
				.sort((a, b) => b[1] - a[1])
				.map(([what, seconds]) => `${what}: ${minutes(seconds)} min`)
		}));
	const untimed = [...new Set(rows.filter((r) => r.minute === null).map((r) => r.day))];
	return {
		sessions: sessions.slice(-MAX_ROWS),
		...(sessions.length > MAX_ROWS && { earlierNotListed: sessions.length - MAX_ROWS }),
		...(untimed.length && { daysWithoutHours: untimed.sort() })
	};
}

/** 0 Monday … 6 Sunday, of a `YYYY-MM-DD`. */
const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;

/** From the first moment of `from` to the last of `to`, in the server's time zone. */
const bounds = (from: string, to: string) => ({
	start: new Date(`${from}T00:00:00`),
	end: new Date(`${to}T23:59:59.999`)
});

async function finishedTool(userId: string, from: string, to: string) {
	const { start, end } = bounds(from, to);
	const [episodes, films] = await Promise.all([
		db
			.select({
				title: episodeTitle,
				seriesTitle: series.title,
				season: episode.season,
				number: episode.number,
				at: watchProgress.updatedAt
			})
			.from(watchProgress)
			.innerJoin(episode, eq(episode.id, watchProgress.episodeId))
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(
				and(
					eq(watchProgress.userId, userId),
					eq(watchProgress.completed, true),
					gte(watchProgress.updatedAt, start),
					lte(watchProgress.updatedAt, end)
				)
			),
		db
			.select({ title: movieTitle, at: movieProgress.updatedAt })
			.from(movieProgress)
			.innerJoin(movie, eq(movie.id, movieProgress.movieId))
			.where(
				and(
					eq(movieProgress.userId, userId),
					eq(movieProgress.completed, true),
					gte(movieProgress.updatedAt, start),
					lte(movieProgress.updatedAt, end)
				)
			)
	]);
	const all = [
		...episodes.map((e) => ({
			what: `«${e.seriesTitle}» T${e.season} E${e.number} «${e.title}»`,
			at: e.at
		})),
		...films.map((f) => ({ what: `Película «${f.title}»`, at: f.at }))
	].sort((a, b) => a.at.getTime() - b.at.getTime());
	return {
		count: all.length,
		rows: all.slice(-MAX_ROWS).map((r) => ({ what: r.what, finished: dateTime.format(r.at) })),
		...(all.length > MAX_ROWS && { earlierNotListed: all.length - MAX_ROWS })
	};
}

async function halfwayTool(userId: string) {
	const [episodes, films] = await Promise.all([
		db
			.select({
				title: episodeTitle,
				seriesTitle: series.title,
				season: episode.season,
				number: episode.number,
				position: watchProgress.positionSec,
				duration: episode.durationSec,
				at: watchProgress.updatedAt
			})
			.from(watchProgress)
			.innerJoin(episode, eq(episode.id, watchProgress.episodeId))
			.innerJoin(series, eq(series.id, episode.seriesId))
			.where(
				and(
					eq(watchProgress.userId, userId),
					eq(watchProgress.completed, false),
					gt(watchProgress.positionSec, 0)
				)
			)
			.orderBy(desc(watchProgress.updatedAt))
			.limit(10),
		db
			.select({
				title: movieTitle,
				position: movieProgress.positionSec,
				duration: movie.durationSec,
				at: movieProgress.updatedAt
			})
			.from(movieProgress)
			.innerJoin(movie, eq(movie.id, movieProgress.movieId))
			.where(
				and(
					eq(movieProgress.userId, userId),
					eq(movieProgress.completed, false),
					gt(movieProgress.positionSec, 0)
				)
			)
			.orderBy(desc(movieProgress.updatedAt))
			.limit(10)
	]);
	const percent = (position: number, duration: number | null) =>
		duration ? `${Math.round((position / duration) * 100)} %` : `${minutes(position)} min`;
	return [
		...episodes.map((e) => ({
			what: `«${e.seriesTitle}» T${e.season} E${e.number} «${e.title}»`,
			seen: percent(e.position, e.duration),
			last: e.at
		})),
		...films.map((f) => ({
			what: `Película «${f.title}»`,
			seen: percent(f.position, f.duration),
			last: f.at
		}))
	]
		.sort((a, b) => b.last.getTime() - a.last.getTime())
		.map((r) => ({ ...r, last: dateTime.format(r.last) }));
}

async function rulesTool(userId: string) {
	const [rules, video, watched] = await Promise.all([
		kidRules(userId),
		videoAllowed(userId),
		watchedToday(userId)
	]);
	return {
		schedule: rules.slots.length
			? WEEKDAYS.map((name, weekday) => {
					const slots = rules.slots.filter((s) => s.weekday === weekday);
					return `${name}: ${slots.length ? slots.map((s) => `${clock(s.startMinute)}–${clock(s.endMinute)}`).join(', ') : 'sin vídeo'}`;
				})
			: 'sin horario: cualquier hora',
		dailyLimit: rules.dailyMinutes === null ? 'sin límite' : `${rules.dailyMinutes} min`,
		access: {
			yes: 'puede ver vídeos (según horario y límite)',
			no: 'vídeos desactivados por un adulto',
			'until-tomorrow': 'vídeos desactivados hasta mañana'
		}[rules.access],
		now: video.allowed
			? `puede ver vídeos${video.until !== null ? ` hasta las ${clock(video.until)}` : ''}`
			: closedText(video, now().weekday),
		watchedTodayMinutes: minutes(watched)
	};
}

/**
 * One of `HISTORY_TOOLS`, run: in words for the model, errors too. Whose is checked here, whatever
 * the model asked for.
 */
export async function runHistoryTool(
	name: string,
	args: Record<string, unknown>,
	whose: Whose
): Promise<string> {
	let person: Person;
	if ('kids' in whose) {
		const kid = whose.kids.find((k) => k.id === args.kid_id);
		if (!kid) return `No hay cuenta infantil con id «${args.kid_id}».`;
		person = kid;
	} else {
		person = whose.self;
		if (name === 'rules') return `No existe la herramienta «${name}».`;
	}
	if (name === 'halfway') return JSON.stringify(await halfwayTool(person.id));
	if (name === 'rules') return JSON.stringify(await rulesTool(person.id));

	const from = String(args.from ?? '');
	const to = String(args.to ?? '');
	if (!DAY.test(from) || !DAY.test(to)) return 'Las fechas, como YYYY-MM-DD.';
	if (from > to) return '«from» tiene que ir antes que «to».';
	if (daysIn(from, to) > MAX_DAYS) return `Como mucho ${MAX_DAYS} días de una vez.`;
	const about = { who: person.name, from, to };
	switch (name) {
		case 'watch_time': {
			const groupBy = String(args.group_by);
			if (!['day', 'series', 'title', 'kind'].includes(groupBy))
				return `Agrupación no válida: «${groupBy}».`;
			const [total] = await db
				.select({ seconds: sql<number>`coalesce(sum(${watchTime.seconds}), 0)::real` })
				.from(watchTime)
				.where(
					and(eq(watchTime.userId, person.id), gte(watchTime.day, from), lte(watchTime.day, to))
				);
			return JSON.stringify({
				...about,
				totalMinutes: minutes(total?.seconds ?? 0),
				...(await watchTimeTool(person.id, from, to, groupBy))
			});
		}
		case 'sessions':
			return JSON.stringify({ ...about, ...(await sessionsTool(person.id, from, to)) });
		case 'finished':
			return JSON.stringify({ ...about, ...(await finishedTool(person.id, from, to)) });
		default:
			return `No existe la herramienta «${name}».`;
	}
}
