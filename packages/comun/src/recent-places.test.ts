import { expect, test } from 'bun:test';
import { matching, remember } from './recent-places.ts';

const place = (label: string) => ({ label, at: [-3.7, 40.4] as [number, number] });
const school = place('Colegio San José, Toledo, España');
const grandparents = place('Calle Ávila 12, Ocaña, España');
const shop = place('Mercadona, Ocaña, España');

test('gone to: first, once, and only the last eight', () => {
	let list = remember([], school);
	list = remember(list, grandparents);
	list = remember(list, school);
	expect(list.map((p) => p.label)).toEqual([school.label, grandparents.label]);
	for (let i = 0; i < 10; i++) list = remember(list, place(`Sitio ${i}`));
	expect(list).toHaveLength(8);
});

test('every word typed, accents and case aside', () => {
	const list = [school, grandparents, shop];
	expect(matching(list, 'avila').map((p) => p.label)).toEqual([grandparents.label]);
	expect(matching(list, 'ocaña merca').map((p) => p.label)).toEqual([shop.label]);
	expect(matching(list, 'OCANA')).toHaveLength(2);
	expect(matching(list, 'playa')).toEqual([]);
});

test('typed nothing: the latest', () => {
	expect(matching([school, grandparents, shop], '', 2)).toEqual([school, grandparents]);
});
