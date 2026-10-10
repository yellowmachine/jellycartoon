/**
 * Title and year from a film's file name without extension (or its folder's name), e.g. `A Fistful of Dollars (1964)` or the
 * names MakeMKV leaves: `Psycho_t02`, `Wall•e Disc 1 T02`, `Hotel Transylvania 3-Fpl Mainfeature T15`.
 */
export function parseMovieName(name: string) {
	let title = name
		.replace(/_+/g, ' ')
		// MakeMKV's title number, sometimes after its "main feature" label.
		.replace(/[\s-]+(?:fpl\s+mainfeature\s+)?t\d{2,3}$/i, '')
		.replace(/\s+disc\s*\d+$/i, '')
		.replace(/\s+/g, ' ')
		.trim();

	let year: number | null = null;
	const withYear = title.match(/^(.+?)\s*\((\d{4})\)$/);
	if (withYear && Number(withYear[2]) >= 1880 && Number(withYear[2]) <= 2100) {
		title = withYear[1];
		year = Number(withYear[2]);
	}

	// `la_niebla` → `La niebla`; `¡cómo…` and the like are left alone.
	title = title.replace(/^\p{Ll}/u, (c) => c.toUpperCase());
	return { title, year };
}
