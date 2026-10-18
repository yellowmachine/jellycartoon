import { describe, expect, test } from 'bun:test';
import {
	activeFilters,
	awardFamily,
	durationOf,
	FILTERS,
	filterLabel,
	matchReason,
	sortFilms,
	watchState,
	type SearchableFilm
} from './film-search.ts';

const jaws: SearchableFilm = {
	title: 'Tiburón',
	originalTitle: 'Jaws',
	directors: ['Steven Spielberg'],
	cast: ['Roy Scheider', 'Robert Shaw', 'Richard Dreyfuss'],
	genres: ['cine de terror'],
	countries: ['Estados Unidos']
};

describe('matchReason', () => {
	test('title, without accents or case', () => {
		expect(matchReason(jaws, 'tiburon')).toBe('');
		expect(matchReason(jaws, '')).toBe('');
	});
	test('original title', () => expect(matchReason(jaws, 'jaws')).toBe('Jaws'));
	test('director', () => expect(matchReason(jaws, 'spielberg')).toBe('Dir. Steven Spielberg'));
	test('actor', () => expect(matchReason(jaws, 'dreyfus')).toBe('Con Richard Dreyfuss'));
	test('no match', () => expect(matchReason(jaws, 'kubrick')).toBeNull());
	test('film without info', () =>
		expect(
			matchReason({ ...jaws, originalTitle: null, directors: [], cast: [] }, 'spielberg')
		).toBeNull());
});

describe('filters', () => {
	test('a person, as director or actor, by exact name', () => {
		expect(FILTERS.persona.matches(jaws, 'Steven Spielberg')).toBe(true);
		expect(FILTERS.persona.matches(jaws, 'Robert Shaw')).toBe(true);
		expect(FILTERS.persona.matches(jaws, 'Robert')).toBe(false);
	});
	test('read from the URL', () =>
		expect(activeFilters(new URLSearchParams('persona=Robert+Shaw&pais=Francia&x=1'))).toEqual([
			{ name: 'persona', value: 'Robert Shaw' },
			{ name: 'pais', value: 'Francia' }
		]));
});

describe('the Cine filters', () => {
	const film = (over: Partial<SearchableFilm>): SearchableFilm => ({ ...jaws, ...over });

	test('watch state: a few seconds in is not started', () => {
		expect(watchState(film({}))).toBe('sin-ver');
		expect(watchState(film({ positionSec: 3 }))).toBe('sin-ver');
		expect(watchState(film({ positionSec: 600 }))).toBe('a-medias');
		expect(watchState(film({ completed: true, positionSec: 0 }))).toBe('vistas');
	});

	test('decade, duration and audio', () => {
		const old = film({ year: 1975, durationSec: 124 * 60, audioTracks: [{ lang: 'en' }] });
		expect(FILTERS.decada.matches(old, '1970')).toBe(true);
		expect(FILTERS.decada.matches(film({ year: null }), '1970')).toBe(false);
		expect(durationOf(old)).toBe('larga');
		expect(durationOf(film({ durationSec: 89 * 60 }))).toBe('corta');
		expect(durationOf(film({ durationSec: null }))).toBeNull();
		expect(FILTERS.audio.matches(old, 'eng')).toBe(true);
		expect(filterLabel('decada', '1980')).toBe('Los 80');
		expect(filterLabel('audio', 'eng')).toBe('English');
		expect(filterLabel('genero', 'western')).toBe('western');
	});

	test('sorting, by title within a tie', () => {
		const films = [
			film({ title: 'B', year: 1990, durationSec: 100 }),
			film({ title: 'A', year: 1990, durationSec: 50 }),
			film({ title: 'C', year: 2001, durationSec: null })
		];
		expect(sortFilms(films, 'anio').map((f) => f.title)).toEqual(['C', 'A', 'B']);
		expect(sortFilms(films, 'duracion').map((f) => f.title)).toEqual(['A', 'B', 'C']);
		expect(sortFilms(films, 'titulo').map((f) => f.title)).toEqual(['A', 'B', 'C']);
	});
});

describe('the second set of Cine filters', () => {
	const back = (over: Partial<SearchableFilm> = {}): SearchableFilm => ({
		...jaws,
		title: 'Regreso al futuro',
		awards: [
			{ name: 'Óscar a la mejor edición de sonido', year: 1986, won: true },
			{ name: 'Óscar al mejor guion original', year: 1986, won: false }
		],
		sagas: [{ name: 'Regreso al futuro', order: 1 }],
		composers: ['Alan Silvestri'],
		...over
	});

	test('award families from their categories', () => {
		expect(awardFamily('Óscar a la mejor película')).toBe('Óscar');
		expect(awardFamily('Óscar al mejor guion original')).toBe('Óscar');
		expect(awardFamily('Premio Goya a la mejor película')).toBe('Premio Goya');
		expect(awardFamily('Globo de Oro a la mejor película - Drama')).toBe('Globo de Oro');
		expect(awardFamily('Palma de Oro')).toBe('Palma de Oro');
		expect(awardFamily('Academy Award for Best Picture')).toBe('Academy Award');
	});

	test('awards: only those won, by family, category or any', () => {
		expect(FILTERS.premio.matches(back(), 'Óscar')).toBe(true);
		expect(FILTERS.premio.matches(back(), '*')).toBe(true);
		expect(FILTERS.premio.matches(back(), 'Óscar al mejor guion original')).toBe(false);
		expect(FILTERS.premio.matches(back({ awards: [] }), '*')).toBe(false);
	});

	test('saga, type and crew', () => {
		expect(FILTERS.saga.matches(back(), 'Regreso al futuro')).toBe(true);
		expect(FILTERS.tipo.matches(back({ blackAndWhite: true }), 'bn')).toBe(true);
		expect(FILTERS.tipo.matches(back(), 'muda')).toBe(false);
		expect(FILTERS.persona.matches(back(), 'Alan Silvestri')).toBe(true);
		expect(matchReason(back(), 'silvestri')).toBe('Música: Alan Silvestri');
	});

	test('with a saga chosen, in its order', () => {
		const films = [
			back({ title: 'Regreso al futuro III', sagas: [{ name: 'Regreso al futuro', order: 3 }] }),
			back(),
			back({ title: 'Regreso al futuro II', sagas: [{ name: 'Regreso al futuro', order: 2 }] })
		];
		expect(sortFilms(films, 'titulo', 'Regreso al futuro').map((f) => f.title)).toEqual([
			'Regreso al futuro',
			'Regreso al futuro II',
			'Regreso al futuro III'
		]);
	});
});
