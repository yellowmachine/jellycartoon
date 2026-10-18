import { languageLabel, normalizeLang } from '#lib/languages.ts';

/** Searching the films on the Cine page: by title, director or actor, and by exact filters. */

export interface SearchableFilm {
	title: string;
	originalTitle: string | null;
	directors: string[];
	cast: string[];
	genres: string[];
	countries: string[];
	year?: number | null;
	durationSec?: number | null;
	audioTracks?: { lang: string }[];
	positionSec?: number | null;
	completed?: boolean | null;
}

/** Watched, started, or not: as the user sees it (a few seconds in is not «started»). */
export function watchState(film: SearchableFilm) {
	if (film.completed) return 'vistas';
	return film.positionSec && film.positionSec > 5 ? 'a-medias' : 'sin-ver';
}

export const WATCH_STATES = { 'sin-ver': 'Sin ver', 'a-medias': 'A medias', vistas: 'Vistas' };

/** `1984` as `1980`. */
export const decadeOf = (year: number) => Math.floor(year / 10) * 10;

/** For a night on a weekday or a long weekend afternoon. */
export const DURATIONS = {
	corta: { label: 'Menos de 90 min', min: 0, max: 90 },
	media: { label: 'De 90 a 120 min', min: 90, max: 120 },
	larga: { label: 'Más de 120 min', min: 120, max: Infinity }
};

export function durationOf(film: SearchableFilm) {
	if (!film.durationSec) return null;
	const minutes = film.durationSec / 60;
	return (Object.keys(DURATIONS) as (keyof typeof DURATIONS)[]).find(
		(k) => minutes >= DURATIONS[k].min && minutes < DURATIONS[k].max
	)!;
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
	},
	estado: {
		label: 'Estado',
		show: (value: string) => WATCH_STATES[value as keyof typeof WATCH_STATES] ?? value,
		matches: (film: SearchableFilm, value: string) => watchState(film) === value
	},
	decada: {
		label: 'Década',
		show: (value: string) => `Los ${value.slice(2)}`,
		matches: (film: SearchableFilm, value: string) =>
			Boolean(film.year) && decadeOf(film.year!) === Number(value)
	},
	duracion: {
		label: 'Duración',
		show: (value: string) => DURATIONS[value as keyof typeof DURATIONS]?.label ?? value,
		matches: (film: SearchableFilm, value: string) => durationOf(film) === value
	},
	audio: {
		label: 'Audio',
		show: (value: string) => languageLabel(value),
		matches: (film: SearchableFilm, value: string) =>
			(film.audioTracks ?? []).some((t) => normalizeLang(t.lang) === value)
	}
} as const satisfies Record<
	string,
	{
		label: string;
		show?: (value: string) => string;
		matches: (film: SearchableFilm, value: string) => boolean;
	}
>;

/** How a filter's value reads in its chip: «Los 80», «Menos de 90 min», «English». */
export function filterLabel(name: FilterName, value: string) {
	const filter = FILTERS[name];
	return 'show' in filter ? filter.show(value) : value;
}

export const SORTS = {
	titulo: 'Título',
	anio: 'Año, las más nuevas',
	recientes: 'Añadidas hace poco',
	duracion: 'Duración, las más cortas'
};
export type SortName = keyof typeof SORTS;

/** In the chosen order; by title (Spanish rules) within the same year, date or length. */
export function sortFilms<T extends SearchableFilm & { addedAt?: Date | string | null }>(
	films: T[],
	sort: SortName
) {
	const byTitle = (a: T, b: T) => a.title.localeCompare(b.title, 'es', { sensitivity: 'base' });
	const time = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : 0);
	const key: Record<SortName, (a: T, b: T) => number> = {
		titulo: () => 0,
		anio: (a, b) => (b.year ?? 0) - (a.year ?? 0),
		recientes: (a, b) => time(b.addedAt) - time(a.addedAt),
		duracion: (a, b) => (a.durationSec ?? Infinity) - (b.durationSec ?? Infinity)
	};
	return films.toSorted((a, b) => key[sort](a, b) || byTitle(a, b));
}

export type FilterName = keyof typeof FILTERS;

export const filterHref = (name: FilterName, value: string) =>
	`/cine?${new URLSearchParams({ [name]: value })}`;

/** The filters in the URL. */
export function activeFilters(params: URLSearchParams) {
	return (Object.keys(FILTERS) as FilterName[]).flatMap((name) =>
		params.getAll(name).map((value) => ({ name, value }))
	);
}
