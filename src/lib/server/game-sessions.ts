import { and, desc, eq, gte, max, min, sql, sum } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { game, gameSession } from '#lib/server/db/schema.ts';
import { allGames } from '#lib/server/games.ts';
import { keepsHistory } from '#lib/server/settings.ts';

/**
 * How long each person plays (#176), from the game's page: it starts a session when the emulator
 * starts, and says every half minute (and when leaving) how many seconds were played since.
 */

/** A new session; null with «Guardar historial» off, which keeps nothing. */
export async function startSession(userId: string, gameId: number) {
	if (!(await keepsHistory(userId))) return null;
	const [row] = await db
		.insert(gameSession)
		.values({ userId, gameId })
		.returning({ id: gameSession.id });
	return row.id;
}

/** Some seconds more: never more than the time that went by since the last report. */
export async function reportSession(userId: string, sessionId: number, seconds: number) {
	const [row] = await db
		.select({ endedAt: gameSession.endedAt })
		.from(gameSession)
		.where(and(eq(gameSession.id, sessionId), eq(gameSession.userId, userId)));
	if (!row) return false;
	const now = new Date();
	const gone = (now.getTime() - row.endedAt.getTime()) / 1000 + 5;
	const played = Math.round(Math.max(0, Math.min(seconds, gone)));
	await db
		.update(gameSession)
		.set({ seconds: sql`${gameSession.seconds} + ${played}`, endedAt: now })
		.where(eq(gameSession.id, sessionId));
	return true;
}

/** What a person has played of one game: in all, and the last time. */
export async function gameTotals(userId: string, gameId: number) {
	const [row] = await db
		.select({ seconds: sum(gameSession.seconds).mapWith(Number), last: max(gameSession.endedAt) })
		.from(gameSession)
		.where(and(eq(gameSession.userId, userId), eq(gameSession.gameId, gameId)));
	return { seconds: row?.seconds ?? 0, last: row?.last?.toISOString() ?? null };
}

/** Sessions shorter than this are in the totals, not in the list: a game opened and left. */
const SHORTEST = 60;

/** A person's statistics: totals, by game, and the last sessions. */
export async function playStats(userId: string) {
	const mine = eq(gameSession.userId, userId);
	const since = (from: string) =>
		db
			.select({ seconds: sum(gameSession.seconds).mapWith(Number) })
			.from(gameSession)
			.where(and(mine, gte(gameSession.startedAt, sql`date_trunc(${from}, now())`)))
			.then(([r]) => r?.seconds ?? 0);
	const [week, month, byGame, recent, systems] = await Promise.all([
		since('week'),
		since('month'),
		db
			.select({
				system: game.system,
				file: game.file,
				seconds: sum(gameSession.seconds).mapWith(Number),
				first: min(gameSession.startedAt),
				last: max(gameSession.endedAt)
			})
			.from(gameSession)
			.innerJoin(game, eq(game.id, gameSession.gameId))
			.where(mine)
			.groupBy(game.system, game.file)
			.orderBy(desc(sum(gameSession.seconds))),
		db
			.select({
				id: gameSession.id,
				system: game.system,
				file: game.file,
				startedAt: gameSession.startedAt,
				endedAt: gameSession.endedAt,
				seconds: gameSession.seconds
			})
			.from(gameSession)
			.innerJoin(game, eq(game.id, gameSession.gameId))
			.where(and(mine, gte(gameSession.seconds, SHORTEST)))
			.orderBy(desc(gameSession.startedAt))
			.limit(30),
		allGames()
	]);
	// Their names as the games screen shows them (FBNeo's for arcade games), and the console's.
	const names = new Map(
		systems.flatMap((s) =>
			s.games.map((g) => [`${s.id}/${g.file}`, { title: g.title, system: s.name }])
		)
	);
	const named = (r: { system: string; file: string }) =>
		names.get(`${r.system}/${r.file}`) ?? { title: r.file, system: r.system };
	return {
		week,
		month,
		total: byGame.reduce((n, g) => n + g.seconds, 0),
		games: byGame.map((g) => ({
			...named(g),
			href: `/tv/juegos/${encodeURIComponent(g.system)}/${encodeURIComponent(g.file)}`,
			seconds: g.seconds,
			first: g.first?.toISOString() ?? null,
			last: g.last?.toISOString() ?? null
		})),
		sessions: recent.map((s) => ({
			id: s.id,
			...named(s),
			startedAt: s.startedAt.toISOString(),
			endedAt: s.endedAt.toISOString(),
			seconds: s.seconds
		}))
	};
}
