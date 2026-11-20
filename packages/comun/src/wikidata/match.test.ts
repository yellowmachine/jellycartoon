import { describe, expect, test } from 'bun:test';
import { pick, queries } from './match.ts';
import type { Candidate } from './wikidata.ts';

const film = (c: Partial<Candidate> & Pick<Candidate, 'id' | 'title'>): Candidate => ({
	names: [c.title],
	description: 'película',
	year: null,
	minutes: null,
	directors: [],
	...c
});

// Shaped after real Wikidata results for titles in the films folder.
const casablanca1942 = film({
	id: 'Q132689',
	title: 'Casablanca',
	year: 1942,
	minutes: 102,
	directors: ['Michael Curtiz']
});
const casablanca2019 = film({ id: 'Q2', title: 'Casablanca', year: 2019, minutes: 78 });
const boneTemple = film({
	id: 'Q129423731',
	title: '28 Years Later: The Bone Temple',
	year: 2026,
	minutes: 109
});
const daysLater = film({
	id: 'Q221075',
	title: '28 Days Later',
	year: 2002,
	minutes: 113,
	directors: ['Danny Boyle']
});

describe('queries', () => {
	test('the AI titles first, then the file title with and without what is in brackets', () => {
		expect(
			queries({
				title: 'Tiburón (Jaws)',
				year: null,
				minutes: null,
				hint: {
					originalTitle: 'Jaws',
					spanishTitle: 'Tiburón',
					year: 1975,
					director: 'Steven Spielberg'
				}
			})
		).toEqual(['Jaws', 'Tiburón', 'Tiburón (Jaws)']);
	});
	test('a film split in parts is searched as the whole film', () => {
		expect(
			queries({
				title: 'El Señor de los Anillos - Las Dos Torres (Ext) Parte 1',
				year: null,
				minutes: null
			})
		).toEqual(['El Señor de los Anillos - Las Dos Torres']);
	});
});

describe('pick', () => {
	test('two films with the same name: the runtime decides', () => {
		const clues = { title: 'Casablanca', year: null, minutes: 102 };
		expect(pick([casablanca2019, casablanca1942], clues).match?.id).toBe('Q132689');
	});
	test('without runtime nor year it asks', () => {
		const clues = { title: 'Casablanca', year: null, minutes: null };
		const { match, ranked } = pick([casablanca1942, casablanca2019], clues);
		expect(match).toBeNull();
		expect(ranked.map((c) => c.id)).toEqual(['Q132689', 'Q2']);
	});
	test('a runtime that matches by chance is not enough without the name', () => {
		const clues = { title: '28 días después', year: null, minutes: 113 };
		expect(pick([boneTemple], clues).match).toBeNull();
	});
	test("the AI's original title, year and director find it", () => {
		const clues = {
			title: '28 días después',
			year: null,
			minutes: 113,
			hint: {
				originalTitle: '28 Days Later',
				spanishTitle: '28 días después',
				year: 2002,
				director: 'Danny Boyle'
			}
		};
		expect(pick([boneTemple, daysLater], clues).match?.id).toBe('Q221075');
	});
});
