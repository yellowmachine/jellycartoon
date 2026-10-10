/** Searching the films on the Cine page: by title, director or actor, and by exact filters. */

export interface SearchableFilm {
	title: string;
	originalTitle: string | null;
	directors: string[];
	cast: string[];
	genres: string[];
	countries: string[];
}

/** Without accents or case: `dalmatas` finds `101 dálmatas`. */
export const normalize = (text: string) =>
	text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/**
 * Whether the film matches the search, and why when it is not obvious from its title: `''` for
 * the title, `Jaws` for the original title, `Dir. …` or `Con …`; `null` when it does not match.
 */
export function matchReason(film: SearchableFilm, search: string): string | null {
	const wanted = normalize(search);
	const has = (text: string) => normalize(text).includes(wanted);
	if (!wanted || has(film.title)) return '';
	if (film.originalTitle && has(film.originalTitle)) return film.originalTitle;
	const director = film.directors.find(has);
	if (director) return `Dir. ${director}`;
	const actor = film.cast.find(has);
	if (actor) return `Con ${actor}`;
	return null;
}

/** Exact filters, from the links on each film page (`/cine?persona=…`). */
export const FILTERS = {
	persona: {
		label: 'Persona',
		matches: (film: SearchableFilm, value: string) =>
			film.directors.includes(value) || film.cast.includes(value)
	},
	genero: {
		label: 'Género',
		matches: (film: SearchableFilm, value: string) => film.genres.includes(value)
	},
	pais: {
		label: 'País',
		matches: (film: SearchableFilm, value: string) => film.countries.includes(value)
	}
} as const;

export type FilterName = keyof typeof FILTERS;

export const filterHref = (name: FilterName, value: string) =>
	`/cine?${new URLSearchParams({ [name]: value })}`;

/** The filters in the URL. */
export function activeFilters(params: URLSearchParams) {
	return (Object.keys(FILTERS) as FilterName[]).flatMap((name) =>
		params.getAll(name).map((value) => ({ name, value }))
	);
}
