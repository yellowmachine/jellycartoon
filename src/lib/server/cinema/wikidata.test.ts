import { expect, test } from 'bun:test';
import { cleanLabel, nameFilmExtras, rawFilmExtras, type Entity } from './wikidata.ts';

const item = (id: string, qualifiers?: Record<string, unknown>) => ({
	mainsnak: { datavalue: { value: { id } } },
	rank: 'normal',
	qualifiers: qualifiers
		? Object.fromEntries(
				Object.entries(qualifiers).map(([k, v]) => [k, [{ datavalue: { value: v } }]])
			)
		: undefined
});

test('awards with their year, sagas in order, crew and black and white', () => {
	const entity: Entity = {
		id: 'Q1',
		claims: {
			P166: [item('Qoscar', { P585: { time: '+1986-03-24T00:00:00Z' } })],
			P1411: [item('Qoscar'), item('Qguion', { P585: { time: '+1986-03-24T00:00:00Z' } })],
			P179: [item('Qsaga', { P1545: '2' })],
			P86: [item('Qsilvestri'), item('Qsilvestri')],
			P462: [item('Q838368')],
			P31: [item('Q11424')]
		}
	};
	const names = new Map([
		['Qoscar', 'Óscar a la mejor edición de sonido'],
		['Qguion', 'Óscar al mejor guion original'],
		['Qsaga', 'Regreso al futuro'],
		['Qsilvestri', 'Alan Silvestri']
	]);
	expect(nameFilmExtras(rawFilmExtras(entity), names)).toEqual({
		awards: [
			{ name: 'Óscar a la mejor edición de sonido', year: 1986, won: true },
			// Won: not listed again as a nomination.
			{ name: 'Óscar al mejor guion original', year: 1986, won: false }
		],
		sagas: [{ name: 'Regreso al futuro', order: 2 }],
		writers: [],
		composers: ['Alan Silvestri'],
		cinematographers: [],
		blackAndWhite: true,
		silent: false
	});
});

test('labels cleaned, and rankings are no saga', () => {
	expect(cleanLabel('Anexo:Premio Annie a la mejor película animada')).toBe(
		'Premio Annie a la mejor película animada'
	);
	expect(cleanLabel('premio Hugo a la mejor presentación dramática')).toBe(
		'Premio Hugo a la mejor presentación dramática'
	);
	const entity: Entity = {
		id: 'Q2',
		claims: { P179: [item('Qghibli'), item('Qbbc', { P1545: '4' })] }
	};
	const names = new Map([
		['Qghibli', 'Studio Ghibli Feature Films'],
		['Qbbc', 'lista de las 100 mejores películas del siglo XXI de la BBC']
	]);
	expect(nameFilmExtras(rawFilmExtras(entity), names).sagas).toEqual([
		{ name: 'Studio Ghibli Feature Films', order: null }
	]);
});
