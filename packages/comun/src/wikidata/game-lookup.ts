import { normalize, pick, queries } from './match.ts';
import { describeGames, gameDetails, searchGames, type GameDetails } from './wikidata.ts';

/**
 * A game's card (#176) by its title, among the games of its console's platforms in Wikidata: the
 * house's (games.ts) and «Tus juegos» in Seilide (#564), each saving it its way.
 */

export interface GameCandidate {
	id: string;
	title: string;
	year: number | null;
	description: string | null;
}

export type GameLookup =
	| { status: 'found'; details: GameDetails }
	| { status: 'ambiguous' | 'not_found'; candidates: GameCandidate[] };

/** No-Intro names are clean enough without the AI. */
export async function lookUpGameInfo(title: string, platforms: string[]): Promise<GameLookup> {
	const known = { title, year: null, minutes: null };
	const ids = [
		...new Set((await Promise.all(queries(known).map((q) => searchGames(q, platforms)))).flat())
	];
	const candidates = await describeGames(ids);
	const { match: likely, ranked } = pick(candidates, known);
	// Without a year to compare, the films' rule doubts too much: a game with exactly that name, if
	// it is the only one, is it («Super Mario World», not «Super Mario World 2: Yoshi's Island»).
	const exact = candidates.filter((c) =>
		c.names.some((n) => normalize(n) === normalize(known.title))
	);
	const match = likely ?? (exact.length === 1 ? exact[0] : null);
	if (match) return { status: 'found', details: await gameDetails(match.id) };
	return {
		status: ranked.length ? 'ambiguous' : 'not_found',
		candidates: ranked.map(({ id, title, year, description }) => ({ id, title, year, description }))
	};
}
