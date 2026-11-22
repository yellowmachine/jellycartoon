import { expect, test } from 'bun:test';
import { openPage, PAGES } from './chat-pages.ts';

/** The pages «Preguntar» opens (#504 phase 3): only these, with the filters their pages read. */

test('each page, with the filters its own page reads from the address', () => {
	expect(openPage('gastos_mes', { month: '2026-10' })).toEqual({
		href: '/gastos?mes=2026-10',
		label: 'Dinero, 2026-10'
	});
	expect(openPage('ingresos_mes', { month: '2026-09' })).toMatchObject({
		href: '/gastos/ingresos?mes=2026-09'
	});
	expect(openPage('analisis', {})).toMatchObject({ href: '/gastos/analisis' });
	expect(openPage('analisis', { months: 12, without_fixed: true })).toEqual({
		href: '/gastos/analisis?meses=12&fijos=no',
		label: 'Dinero → Análisis, 12 meses, sin fijos'
	});
	expect(
		openPage('busqueda', { words: ' Mercadona ', from_day: '2026-07-12', to_day: '2026-07-14' })
	).toEqual({
		href: '/gastos/busqueda?q=Mercadona&desde=2026-07-12&hasta=2026-07-14',
		label: 'Dinero → Búsqueda «Mercadona» del 2026-07-12 al 2026-07-14'
	});
	expect(openPage('facturas', { kind: 'Agua' })).toMatchObject({
		href: '/gastos/facturas?de=Agua'
	});
	expect(openPage('agenda', { day: '2026-11-16', month_view: true })).toMatchObject({
		href: '/agenda?dia=2026-11-16&vista=mes'
	});
	expect(openPage('notas', { words: 'coche' })).toMatchObject({ href: '/notas?q=coche' });
	expect(openPage('viajes', {})).toEqual({ href: '/viajes', label: 'Viajes' });
});

test('what is wrong, in words for the AI; never an address it wrote', () => {
	expect(openPage('gastos_mes', { month: 'octubre' })).toBe('Falta el mes, AAAA-MM.');
	expect(openPage('busqueda', {})).toBe('Falta qué buscar o entre qué días.');
	expect(openPage('https://malo.example', {})).toBe(
		'No hay ninguna página «https://malo.example».'
	);
	expect(openPage('__proto__', {})).toBe('No hay ninguna página «__proto__».');
	// Filters it does not know, or out of range, left out or by default.
	expect(openPage('analisis', { months: 7, href: '//malo' })).toMatchObject({
		href: '/gastos/analisis'
	});
	expect(openPage('facturas', { kind: 'Teléfono' })).toMatchObject({
		href: '/gastos/facturas?de=Luz'
	});
	expect(openPage('agenda', { day: '2026-13-01' })).toMatchObject({ href: '/agenda' });
	// Every page opens with no filters but those that need one.
	for (const name of Object.keys(PAGES))
		expect(typeof openPage(name, { month: '2026-10', words: 'x' })).toBe('object');
});

test('the wishes, of a shop if said', () => {
	expect(openPage('deseos', {})).toEqual({ href: '/deseos', label: 'Deseos' });
	expect(openPage('deseos', { shop: 'Amazon' })).toEqual({
		href: '/deseos?tienda=Amazon',
		label: 'Deseos de Amazon'
	});
});
