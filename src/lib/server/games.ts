import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { gamesRoot } from '#lib/server/library/paths.ts';

/**
 * The folders of GAMES_DIR that are played (#176), each with one system of EmulatorJS
 * (https://emulatorjs.org/docs/systems), which picks its default core. Only the light consoles:
 * other folders are left out.
 */
export const SYSTEMS: Record<string, { name: string; core: string }> = {
	nes: { name: 'NES', core: 'nes' },
	snes: { name: 'Super Nintendo', core: 'snes' },
	gb: { name: 'Game Boy', core: 'gb' },
	gbc: { name: 'Game Boy Color', core: 'gb' },
	gba: { name: 'Game Boy Advance', core: 'gba' },
	megadrive: { name: 'Mega Drive', core: 'segaMD' }
};

export type Game = { system: string; file: string; title: string };

/** «Super Mario World (Europe).7z» → «Super Mario World»: no extension, no region or version. */
const titleOf = (file: string) =>
	path
		.parse(file)
		.name.replace(/(\s*[([][^)\]]*[)\]])+$/, '')
		.trim() || file;

/** The games of a system's folder, by title; none if there is no folder. Read each time. */
async function gamesIn(system: string): Promise<Game[]> {
	const entries = await readdir(path.join(gamesRoot!, system), { withFileTypes: true }).catch(
		() => []
	);
	return entries
		.filter((e) => e.isFile() && !e.name.startsWith('.'))
		.map((e) => ({ system, file: e.name, title: titleOf(e.name) }))
		.sort((a, b) => a.title.localeCompare(b.title, 'es'));
}

/** Every system with games, in SYSTEMS' order. */
export async function allGames() {
	const systems = await Promise.all(
		Object.entries(SYSTEMS).map(async ([id, { name }]) => ({ id, name, games: await gamesIn(id) }))
	);
	return systems.filter((s) => s.games.length > 0);
}

/**
 * A game by its folder and file name, as the URL has them: only a file that is there, so nothing
 * outside GAMES_DIR can be asked for.
 */
export async function findGame(system: string, file: string) {
	if (!gamesRoot || !Object.hasOwn(SYSTEMS, system)) return null;
	const game = (await gamesIn(system)).find((g) => g.file === file);
	return game && { ...game, path: path.join(gamesRoot, system, game.file) };
}
