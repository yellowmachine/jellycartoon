import { isSystem, mayBeGame, nameOf, titleOf } from 'comun/game-systems.ts';

/**
 * «Tus juegos» (#564): which of the bucket's keys are games, as the house reads its GAMES_DIR: a
 * file right inside a console's folder (`snes/Super Mario World (Europe).sfc`), whatever its case
 * (`SNES/`). Apart from the app, to be tried on its own.
 */

/** Not yet: the arcade games need FBNeo's list and their BIOS (phase 2). */
const LATER = new Set(['arcade']);

export interface ListedGame {
	system: string;
	file: string;
	key: string;
	size: number;
	title: string;
	fullName: string;
}

/** The games among the keys under `prefix` (the bucket's folder for them). */
export function gamesOf(listed: { key: string; size: number }[], prefix: string): ListedGame[] {
	const games = new Map<string, ListedGame>();
	for (const { key, size } of listed) {
		if (!key.startsWith(prefix)) continue;
		const parts = key.slice(prefix.length).split('/');
		if (parts.length !== 2) continue;
		const [folder, file] = parts;
		const system = folder.toLowerCase();
		if (!isSystem(system) || LATER.has(system) || !mayBeGame(file)) continue;
		const fullName = nameOf(file);
		// The same file in `snes/` and `SNES/`: the first one.
		const id = `${system}/${file}`;
		if (!games.has(id))
			games.set(id, { system, file, key, size, title: titleOf(fullName), fullName });
	}
	return [...games.values()];
}
