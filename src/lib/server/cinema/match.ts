import type { Candidate } from './wikidata.ts';

/** What is known of a film before looking it up: from its file and, optionally, from the AI. */
export interface Clues {
	/** The catalogue title, e.g. `Tiburón (Jaws)` or `Agárralo como puedas 33 y 1-3`. */
	title: string;
	year: number | null;
	/** Runtime of the file. */
	minutes: number | null;
	/** The AI's guess, when there is a key. */
	hint?: {
		originalTitle: string;
		spanishTitle: string | null;
		year: number | null;
		director: string | null;
	};
}

/** Lowercase, without accents nor punctuation: `¡Cómo está…!` and `como esta` compare equal. */
export const normalize = (text: string) =>
	text
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();

/** A film split in two files (`… Parte 1`): its runtime says nothing about the whole film. */
const isPart = (title: string) => /\bparte\s*\d\b/i.test(title);

/** Texts to search for, most specific first: the AI's titles, then variations of the file's. */
export function queries(clues: Clues) {
	const { title, hint } = clues;
	const withoutParts = title
		.replace(/\((ext|extendida|extended)\)/gi, '')
		.replace(/\bparte\s*\d\b/gi, '')
		.trim();
	const inside = [...withoutParts.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
	const outside = withoutParts.replace(/\([^)]*\)/g, '').trim();
	const all = [hint?.originalTitle, hint?.spanishTitle, withoutParts, outside, ...inside];
	return [
		...new Map(
			all.filter((q): q is string => !!q?.trim()).map((q) => [normalize(q), q.trim()])
		).values()
	];
}

/** How a candidate compares with the clues. Each clue adds when it matches and subtracts when it clearly does not. */
export function score(candidate: Candidate, clues: Clues) {
	const wanted = queries(clues).map(normalize);
	const names = candidate.names.map(normalize);
	let points = 0;

	const exactName = names.some((n) => wanted.includes(n));
	const nameMatches =
		exactName || names.some((n) => wanted.some((w) => n.includes(w) || w.includes(n)));
	points += exactName ? 3 : nameMatches ? 1 : 0;

	const year = clues.hint?.year ?? clues.year;
	const yearMatches = Boolean(year && candidate.year === year);
	if (year && candidate.year) {
		const off = Math.abs(year - candidate.year);
		points += off === 0 ? 4 : off === 1 ? 2 : -2;
	}

	if (clues.minutes && candidate.minutes && !isPart(clues.title)) {
		const off = Math.abs(clues.minutes - candidate.minutes);
		points += off <= 5 ? 3 : off <= 12 ? 1 : off > 25 ? -2 : 0;
	}

	const director = clues.hint?.director && normalize(clues.hint.director);
	const directorMatches = Boolean(
		director &&
		candidate.directors.some((d) => {
			const name = normalize(d);
			return name.includes(director) || director.includes(name);
		})
	);
	if (directorMatches) points += 4;

	// A runtime or a year can match by chance: the name, or the AI's year and director together,
	// must agree before a film is taken without asking.
	const trustworthy = nameMatches || (yearMatches && directorMatches);
	return { points, trustworthy };
}

/**
 * The film, when one candidate is clearly ahead; otherwise the most likely ones, for the user to
 * choose from.
 */
export function pick(candidates: Candidate[], clues: Clues) {
	const ranked = candidates
		.map((candidate, order) => {
			const { points, trustworthy } = score(candidate, clues);
			// Wikidata's own order breaks ties.
			return { candidate, points: points - order * 0.1, trustworthy };
		})
		.sort((a, b) => b.points - a.points);
	const [best, second] = ranked;
	const clear =
		best?.trustworthy && best.points >= 3 && (!second || best.points - second.points >= 2);
	return {
		match: clear ? best.candidate : null,
		ranked: ranked.slice(0, 6).map((r) => r.candidate)
	};
}
