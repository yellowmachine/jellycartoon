import { describe, expect, test } from 'bun:test';
import { activeFilters, FILTERS, matchReason, type SearchableFilm } from './film-search.ts';

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
