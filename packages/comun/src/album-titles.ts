/**
 * An album's title, to look it up in MusicBrainz: in the house (its covers, music/covers.ts) and in
 * Seilide (Tu música, #534).
 */

/**
 * Titles to look an album up by, best first: without the year some rippers put in front, the disc
 * number or catalogue numbers, and then also without anything in brackets.
 */
export function searchTitles(title: string) {
	const clean = title
		.replace(/^\d{4}\s*-\s*/, '')
		.replace(/\s*\[[^\]]*\]/g, '')
		.replace(/\s*\((?:CD|Dis[ck])\s*[\w]+\)/gi, '')
		.replace(/\s*-\s*(?:CD|Dis[ck])\s*\d+\s*$/i, '')
		.trim();
	const bare = clean.replace(/\s*\([^)]*\)/g, '').trim();
	return [...new Set([clean, bare])].filter(Boolean);
}

const words = (title: string) =>
	title
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/**
 * Whether a title found in MusicBrainz is ours: it has (almost) every word of it. A search by words
 * scores unrelated albums of the same artist as high as the right one.
 */
export function titlesMatch(ours: string, found: string) {
	const theirs = new Set(words(found));
	const mine = words(ours);
	if (!mine.length) return false;
	return mine.filter((w) => theirs.has(w)).length / mine.length >= 0.8;
}
