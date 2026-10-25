/** Reading FinalBurn Neo's list of games (fbneo.ts), apart so it can be tested on its own. */

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
