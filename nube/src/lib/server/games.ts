import type { ConsoleCard, ConsoleGame, GameInfo, GameSummary, PlayerData } from 'comun/games.ts';
import { askHouse } from './house.ts';

/** The games (#405) are the house's: Seilide only shows them, and passes on what the game asks. */

type Who = { id: string; email: string };

/** Fetching what is missing from libretro or Wikidata takes longer than a list. */
const SLOW_MS = 60_000;

const game = (system: string, file: string) =>
	`/juegos/paginas/${encodeURIComponent(system)}/${encodeURIComponent(file)}`;

export const gameConsoles = (who: Who) =>
	askHouse<ConsoleCard[]>(who.id, who.email, '/juegos/paginas');

export const consoleGames = (who: Who, system: string) =>
	askHouse<{ name: string; games: ConsoleGame[] }>(
		who.id,
		who.email,
		`/juegos/paginas/${encodeURIComponent(system)}`
	);

export const consoleCovers = (who: Who, system: string) =>
	askHouse<Record<string, string>>(
		who.id,
		who.email,
		`/juegos/paginas/${encodeURIComponent(system)}/caratulas`,
		{},
		SLOW_MS
	);

export const gameSummary = (who: Who, system: string, file: string) =>
	askHouse<GameSummary>(who.id, who.email, game(system, file));

export const gameDetails = (who: Who, system: string, file: string) =>
	askHouse<{ backdrop: string | null; info: GameInfo | null }>(
		who.id,
		who.email,
		`${game(system, file)}/ficha`,
		{},
		SLOW_MS
	);

export const gamePlayer = (who: Who, system: string, file: string) =>
	askHouse<PlayerData>(who.id, who.email, `${game(system, file)}/jugar`);
