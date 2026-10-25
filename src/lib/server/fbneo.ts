import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from '#lib/server/library/paths.ts';
import { parse, type ArcadeGame } from './fbneo-list.ts';

export { biosOf, type ArcadeGame } from './fbneo-list.ts';

/**
 * FinalBurn Neo's list of arcade games (#176), for the `arcade` folder: its ROMs are named by
 * FBNeo's short names (`sf2.zip`), and this gives their titles and which BIOS each one needs
 * (`neogeo.zip`). The list of the same days as EmulatorJS 4.2.3's FBNeo core (built 2025-06-14):
 * its games change while its version stays 1.0.0.03.
 */
const DAT_COMMIT = 'e8291a39f637d23900d6998ea7f67648856201f9';
const DAT_URL =
	`https://raw.githubusercontent.com/libretro/FBNeo/${DAT_COMMIT}/dats/` +
	encodeURIComponent('FinalBurn Neo (ClrMame Pro XML, Arcade only).dat');

/** What is kept of it, read once from the 13 MB list; another list, another file. */
const cacheFile = path.join(dataRoot, 'juegos', `fbneo-${DAT_COMMIT.slice(0, 7)}.json`);

let loading: Promise<Record<string, ArcadeGame>> | null = null;

/** The list: from DATA_DIR, or else fetched once and kept there. */
export function arcadeGames() {
	loading ??= (async () => {
		const saved = await readFile(cacheFile, 'utf8').catch(() => null);
		if (saved) return JSON.parse(saved) as Record<string, ArcadeGame>;
		const res = await fetch(DAT_URL, { signal: AbortSignal.timeout(120_000) });
		if (!res.ok) throw new Error(`Lista de FBNeo: ${res.status} ${res.statusText}`);
		const games = parse(await res.text());
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
