import { expect, test } from 'bun:test';
import { partsOf, type Part } from './merge-match.ts';

const part = (id: number, total: number, title = '', store = 'IberLibro'): Part => ({
	id,
	date: '2026-11-20',
	store,
	total,
	titles: title ? [title] : []
});
const bill = (total: number, lines: [string, number][] = [], store = 'Iberlibro.com') => ({
	store,
	total,
	lines: lines.map(([text, amount]) => ({ text, amount }))
});
const ids = (found: Part[] | null) => found?.map((p) => p.id) ?? null;
const A = part(1, 1811, 'El nombre de la rosa');
const B = part(2, 1789, 'Cien años de soledad');

test('by the titles in its lines, also of another shop and not to the cent', () => {
	const b = bill(
		3650,
		[
			['EL NOMBRE DE LA ROSA - Umberto Eco', 1800],
			['Cien anos de soledad, tapa dura', 1700],
			['Envío', 150]
		],
		'Librería Pérez'
	);
	expect(ids(partsOf(b, [A, B, part(3, 900, 'Otra cosa distinta')]))).toEqual([1, 2]);
	// Each book in three lines: its price, its sending and its VAT.
	const six = bill(
		3740,
		[
			['El nombre de la rosa', 522],
			['Envío - El nombre de la rosa', 1219],
			['IVA - El nombre de la rosa', 70],
			['Cien años de soledad', 500],
			['Envío - Cien años de soledad', 1219],
			['IVA - Cien años de soledad', 210]
		],
		'AbeBooks'
	);
	expect(ids(partsOf(six, [A, B]))).toEqual([1, 2]);
	// One book of an order of many is not all of it.
	expect(partsOf(bill(9000, [['El nombre de la rosa', 1811]]), [A])).toBeNull();
	// Two that could be the same line: a doubt.
	expect(
		partsOf(bill(1811, [['El nombre de la rosa', 1811]], 'X'), [
			A,
			part(4, 1811, 'El nombre de la rosa', 'Otra')
		])
	).toBeNull();
});

test('by the sum, of the same shop and in only one way', () => {
	expect(ids(partsOf(bill(3600), [A, B]))).toEqual([1, 2]);
	expect(ids(partsOf(bill(3605), [A, B]))).toEqual([1, 2]);
	expect(partsOf(bill(3700), [A, B])).toBeNull();
	expect(partsOf(bill(3600, [], 'Mercadona'), [A, B])).toBeNull();
	// Several ways.
	expect(partsOf(bill(2000), [part(1, 1000), part(2, 1000), part(3, 1000)])).toBeNull();
	// One alone, only exactly.
	expect(ids(partsOf(bill(1811), [A]))).toEqual([1]);
	expect(partsOf(bill(1815), [A])).toBeNull();
	expect(partsOf(bill(0), [A])).toBeNull();
	// More than five are not tried.
	expect(
		partsOf(
			bill(600),
			Array.from({ length: 6 }, (_, i) => part(i + 1, 100))
		)
	).toBeNull();
});
