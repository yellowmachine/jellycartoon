/**
 * FinalBurn Neo's list of arcade games (#176): its ROMs are named by FBNeo's short names
 * (`sf2.zip`), and this gives their titles and which BIOS each one needs (`neogeo.zip`). Read by
 * the house (fbneo.ts, kept in DATA_DIR) and by Seilide for «Tus juegos» (#564, in memory).
 */

/**
 * The list of the same days as EmulatorJS 4.2.3's FBNeo core (built 2025-06-14): its games change
 * while its version stays 1.0.0.03.
 */
export const DAT_COMMIT = 'e8291a39f637d23900d6998ea7f67648856201f9';
export const DAT_URL =
	`https://raw.githubusercontent.com/libretro/FBNeo/${DAT_COMMIT}/dats/` +
	encodeURIComponent('FinalBurn Neo (ClrMame Pro XML, Arcade only).dat');

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

/** The BIOS a game needs, following its clones up (`mslugx` → `mslug` → `neogeo`); null if none. */
export function biosOf(games: Record<string, ArcadeGame>, name: string) {
	for (let set = games[name], seen = 0; set?.romof && seen < 10; seen++) {
		const parent = games[set.romof];
		if (parent?.isBios) return set.romof;
		set = parent;
	}
	return null;
}

/** The list fetched (13 MB) and read; a failed answer, an error. */
export async function fetchArcadeGames() {
	const res = await fetch(DAT_URL, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`Lista de FBNeo: ${res.status} ${res.statusText}`);
	return parse(await res.text());
}
