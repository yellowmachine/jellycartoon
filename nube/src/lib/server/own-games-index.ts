import { biosOf, type ArcadeGame } from 'comun/fbneo-list.ts';
import { isSystem, mayBeGame, nameOf, titleOf } from 'comun/game-systems.ts';

/**
 * «Tus juegos» (#564): which of the bucket's keys are games, as the house reads its GAMES_DIR: a
 * file right inside a console's folder (`snes/Super Mario World (Europe).sfc`), whatever its case
 * (`SNES/`). The arcade games (`arcade/sf2.zip`) by FinalBurn Neo's list, as the house's: their
 * titles, and the BIOS each needs if it is in the folder too (a BIOS is not a game). Apart from
 * the app, to be tried on its own.
 */

export interface ListedGame {
	system: string;
	file: string;
	key: string;
	size: number;
	title: string;
	fullName: string;
	/** The BIOS's key it needs (`Juegos/arcade/neogeo.zip`), in the arcade folder; null, none. */
	biosKey: string | null;
}

/**
 * The games among the keys under `prefix` (the bucket's folder for them). `arcade`, FBNeo's list;
 * without it (it could not be had), the arcade games by their short names.
 */
export function gamesOf(
	listed: { key: string; size: number }[],
	prefix: string,
	arcade: Record<string, ArcadeGame> | null = null
): ListedGame[] {
	const games = new Map<string, ListedGame>();
	// The arcade folder's files, by name: their keys (the first, as below).
	const arcadeFiles = new Map<string, string>();
	for (const { key } of listed) {
		const parts = key.slice(prefix.length).split('/');
		if (key.startsWith(prefix) && parts.length === 2 && parts[0].toLowerCase() === 'arcade')
			if (!arcadeFiles.has(parts[1])) arcadeFiles.set(parts[1], key);
	}
	for (const { key, size } of listed) {
		if (!key.startsWith(prefix)) continue;
		const parts = key.slice(prefix.length).split('/');
		if (parts.length !== 2) continue;
		const [folder, file] = parts;
		const system = folder.toLowerCase();
		if (!isSystem(system) || !mayBeGame(file)) continue;
		const name = nameOf(file);
		// The same file in `snes/` and `SNES/`: the first one.
		const id = `${system}/${file}`;
		if (games.has(id)) continue;
		if (system !== 'arcade' || !arcade) {
			games.set(id, {
				system,
				file,
				key,
				size,
				title: titleOf(name),
				fullName: name,
				biosKey: null
			});
			continue;
		}
		const known = arcade[name];
		if (known?.isBios) continue;
		const bios = biosOf(arcade, name);
		games.set(id, {
			system,
			file,
			key,
			size,
			title: known ? titleOf(known.description) : name,
			fullName: known?.description ?? name,
			biosKey: (bios && arcadeFiles.get(`${bios}.zip`)) ?? null
		});
	}
	return [...games.values()];
}

/** Whether any of the keys is an arcade game's, to fetch FBNeo's list only then. */
export const hasArcade = (listed: { key: string }[], prefix: string) =>
	listed.some(({ key }) => {
		const parts = key.slice(prefix.length).split('/');
		return key.startsWith(prefix) && parts.length === 2 && parts[0].toLowerCase() === 'arcade';
	});
