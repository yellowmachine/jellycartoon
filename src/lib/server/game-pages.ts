import { error } from '@sveltejs/kit';
import { controlsOf } from '#lib/server/game-controls.ts';
import { shaderFor } from '#lib/server/game-shaders.ts';
import { savesOf } from '#lib/server/game-saves.ts';
import { gameTotals } from '#lib/server/game-sessions.ts';
import {
	allGames,
	fetchPictures,
	findGame,
	gameBackdropUrl,
	gamePictures,
	gameRow,
	lookUpGame,
	SYSTEMS,
	systemCovers,
	type GameRow
} from '#lib/server/games.ts';
import { log } from '#lib/server/log.ts';
import { retrodeckEnabled } from '#lib/server/retrodeck.ts';

/**
 * What the games' pages show (#176), in the TV view and in the browser (#405): the same games,
 * saved games and play time, each with its own way of showing them.
 */

/** Tiles in each console's mosaic: 3 × 2. */
const MOSAIC = 6;

/** One per console with games, with its games' boxes already fetched (when they were shown). */
export const consoleCards = async () =>
	Promise.all(
		(await allGames()).map(async (s) => ({
			id: s.id,
			name: s.name,
			count: s.games.length,
			images: Object.values(await systemCovers(s.id, s.games, false)).slice(0, MOSAIC)
		}))
	);

/** A console's games, each with its box. */
export async function consolePage(id: string) {
	const system = (await allGames()).find((s) => s.id === id);
	if (!system) error(404, 'No hay juegos de esa consola');
	return {
		name: SYSTEMS[system.id].name,
		games: system.games.map(({ file, title }) => ({ file, title })),
		// Those missing are fetched from libretro, while the page is already shown.
		covers: systemCovers(system.id, system.games).catch((problem): Record<string, string> => {
			log.warn('juegos', 'No se pudieron bajar las carátulas', {
				system: system.id,
				error: problem
			});
			return {};
		})
	};
}

/** Only what the page shows. */
const card = (row: GameRow) => ({
	status: row.status,
	year: row.year,
	developers: row.developers,
	publishers: row.publishers,
	genres: row.genres,
	modes: row.modes,
	composers: row.composers,
	synopsis: row.synopsis,
	candidates: row.candidates
});

export async function foundGame(params: { system: string; file: string }) {
	const game = await findGame(params.system, params.file);
	if (!game) error(404, 'Juego no encontrado');
	return { game, row: await gameRow(game.system, game.file) };
}

/** A game's page: what it is, its background and «Jugar». */
export async function gamePage(params: { system: string; file: string }, userId: string) {
	const { game, row } = await foundGame(params);
	// libretro's pictures the first time, while the page is already shown.
	const pictures = fetchPictures(row, game).catch((problem) =>
		log.warn('juegos', `No se pudo poner el fondo de «${game.title}»`, {
			gameId: row.id,
			error: problem
		})
	);
	return {
		title: game.title,
		system: SYSTEMS[game.system].name,
		backdrop: pictures.then(() => gameBackdropUrl(row.id)),
		pictures: pictures.then(() => gamePictures(row.id)),
		/** The person's saved games of it, to go on from one. */
		saves: await savesOf(userId, row.id),
		/** How long the person has played it, and the last time. */
		played: await gameTotals(userId, row.id),
		/** Whether it can also be played in RetroDECK, on the PC with the screen. */
		retrodeck: await retrodeckEnabled(),
		// Looked up the first time, while the page is already shown.
		info: row.status
			? card(row)
			: lookUpGame(row, game.title).then(card, (problem) => {
					log.warn('juegos', `No se pudo buscar la ficha de «${game.title}»`, {
						gameId: row.id,
						error: problem
					});
					return null;
				})
	};
}

/** What the player needs (GamePlayer.svelte). */
export async function playerPage(params: { system: string; file: string }, userId: string) {
	const { game, row } = await foundGame(params);
	return {
		title: game.title,
		core: SYSTEMS[game.system].core,
		rom: `/api/juegos/${encodeURIComponent(game.system)}/${encodeURIComponent(game.file)}`,
		/** The BIOS it needs (Neo Geo's), from the same folder. */
		bios:
			game.bios &&
			`/api/juegos/${encodeURIComponent(game.system)}/${encodeURIComponent(game.bios)}`,
		/** Its row, for the saved games of its menu. */
		gameId: row.id,
		/** Where a capture of the game goes, as the background of its page. */
		backdrop: `/api/fondo/juego/${row.id}`,
		/** The person's cartridge save of it, on the server. */
		cartridge: `/api/juegos/cartucho/${row.id}`,
		/** The person's buttons for its console. */
		controls: await controlsOf(userId, game.system),
		/** The house's shader for it (/juegos/shaders): its own, and the one it has without it. */
		shader: await shaderFor(game.system, row.id)
	};
}

export type PlayerData = Awaited<ReturnType<typeof playerPage>>;
