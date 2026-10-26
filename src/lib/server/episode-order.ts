import { and, asc, eq, gt, lt, or, sql } from 'drizzle-orm';
import { episode } from '#lib/server/db/schema.ts';

/**
 * Season 0 is the extras (#220): shown after the last season, and kept apart from the normal
 * order: after the last normal episode nothing comes next, and extras only lead to extras.
 */

/** Season and number, the extras after the last season. */
export const episodeOrder = [sql`${episode.season} = 0`, asc(episode.season), asc(episode.number)];

/** The same, for episodes already loaded. */
export function byEpisodeOrder(
	a: { season: number; number: number },
	b: { season: number; number: number }
) {
	return (
		Number(a.season === 0) - Number(b.season === 0) || a.season - b.season || a.number - b.number
	);
}

/** Extras with extras, the rest with the rest. */
const sameKind = (ep: { season: number }) =>
	ep.season === 0 ? eq(episode.season, 0) : gt(episode.season, 0);

/** The episodes after this one, of its kind. */
export const episodesAfter = (ep: { season: number; number: number }) =>
	and(
		sameKind(ep),
		or(
			gt(episode.season, ep.season),
			and(eq(episode.season, ep.season), gt(episode.number, ep.number))
		)
	);

/** The episodes before this one, of its kind. */
export const episodesBefore = (ep: { season: number; number: number }) =>
	and(
		sameKind(ep),
		or(
			lt(episode.season, ep.season),
			and(eq(episode.season, ep.season), lt(episode.number, ep.number))
		)
	);
