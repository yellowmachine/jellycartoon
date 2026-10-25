import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataRoot } from '#lib/server/library/paths.ts';

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

export interface ArcadeGame {
	/** «Street Fighter II: The World Warrior (World 910522)». */
	description: string;
	/** The set it is a clone of, or its BIOS. */
	romof?: string;
	isBios?: boolean;
}

const decode = (text: string) =>
	text
		.replaceAll('&quot;', '"')
		.replaceAll('&apos;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replaceAll('&amp;', '&');

const attribute = (attributes: string, name: string) =>
	new RegExp(`\\b${name}="([^"]*)"`).exec(attributes)?.[1];

/**
 * Its games by short name, from the list's `<game name="…" romof="…">` and their `<description>`,
 * which may come after a `<comment>` (the BIOS's).
 */
export function parse(xml: string) {
	const games: Record<string, ArcadeGame> = {};
	for (const m of xml.matchAll(
		/<game ([^>]*)>(?:(?!<\/game>)[\s\S])*?<description>([^<]*)<\/description>/g
	)) {
		const name = attribute(m[1], 'name');
		if (!name) continue;
		const romof = attribute(m[1], 'romof');
		games[name] = {
			description: decode(m[2]),
			...(romof ? { romof } : {}),
			...(attribute(m[1], 'isbios') === 'yes' ? { isBios: true } : {})
		};
	}
	return games;
}

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

/** The BIOS a game needs, following its clones up (`mslugx` → `mslug` → `neogeo`); null if none. */
export function biosOf(games: Record<string, ArcadeGame>, name: string) {
	for (let set = games[name], seen = 0; set?.romof && seen < 10; seen++) {
		const parent = games[set.romof];
		if (parent?.isBios) return set.romof;
		set = parent;
	}
	return null;
}
