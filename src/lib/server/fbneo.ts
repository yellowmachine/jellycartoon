import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from '#lib/server/library/paths.ts';
import { DAT_COMMIT, fetchArcadeGames, type ArcadeGame } from 'comun/fbneo-list.ts';

export { biosOf, type ArcadeGame } from 'comun/fbneo-list.ts';

/**
 * FinalBurn Neo's list (comun's fbneo-list.ts) for the `arcade` folder: what is kept of it in
 * DATA_DIR, read once from the 13 MB list; another list, another file.
 */
const cacheFile = path.join(dataRoot, 'juegos', `fbneo-${DAT_COMMIT.slice(0, 7)}.json`);

let loading: Promise<Record<string, ArcadeGame>> | null = null;

/** The list: from DATA_DIR, or else fetched once and kept there. */
export function arcadeGames() {
	loading ??= (async () => {
		const saved = await readFile(cacheFile, 'utf8').catch(() => null);
		if (saved) return JSON.parse(saved) as Record<string, ArcadeGame>;
		const games = await fetchArcadeGames();
		await mkdir(path.dirname(cacheFile), { recursive: true });
		await writeFile(`${cacheFile}.part`, JSON.stringify(games));
		await rename(`${cacheFile}.part`, cacheFile);
		return games;
	})().catch((problem) => {
		// Tried again next time.
		loading = null;
		throw problem;
	});
	return loading;
}
