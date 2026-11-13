import { expect, test } from 'bun:test';
import {
	mySectionList,
	navLinks,
	savedMine,
	savedSections,
	sectionList,
	sectionOn
} from './nav.ts';

test('without a house connected, nothing of it in the bar', () => {
	const { links, userLinks } = navLinks(false, false);
	const labels = links.map((l) => l.label);
	expect(labels).not.toContain('Series');
	expect(labels).not.toContain('Música');
	expect(labels).toContain('Recetas');
	expect(userLinks.map((l) => l.label)).toEqual(['Buzón', 'Ajustes']);
});

test("with a house, what it serves through the cloud; nothing that goes to the house's page", () => {
	const { links, menuLinks, userLinks } = navLinks(false, true);
	const labels = links.map((l) => l.label);
	expect(labels).toContain('Series');
	expect(labels).toContain('Música');
	for (const away of ['Cine', 'Salón', 'Juegos', 'Infantil']) expect(labels).not.toContain(away);
	expect(links.some((l) => l.external || !l.href.startsWith('/'))).toBe(false);
	expect(menuLinks.map((l) => l.label)).not.toContain('Gestión');
	// With a house, its TV's QR (#172).
	expect(userLinks.map((l) => l.label)).toEqual(['Leer un QR', 'Buzón', 'Ajustes']);
});

test('«Leer un QR»: with a house or some child to let in; without either, not', () => {
	expect(navLinks(false, false).userLinks.map((l) => l.label)).toEqual(['Buzón', 'Ajustes']);
	expect(navLinks(false, false, false, true).userLinks.map((l) => l.label)).toContain('Leer un QR');
});

test('Oración (#339), only with it on; for a child too', () => {
	expect(navLinks(false, true).links.map((l) => l.label)).not.toContain('Oración');
	expect(navLinks(false, true, false, false, true).links.map((l) => l.label)).toContain('Oración');
	expect(navLinks(false, true, true, false, true).links.map((l) => l.label)).toContain('Oración');
});

const barOf = (sections: Record<string, boolean>, kid = false) =>
	navLinks(false, true, kid, false, false, sections).links.map((l) => l.label);

test('Deberes starts out of the bar, for a child too, until the family turns it on', () => {
	expect(barOf({})).not.toContain('Deberes');
	expect(barOf({}, true)).not.toContain('Deberes');
	expect(barOf({ '/deberes': true })).toContain('Deberes');
	expect(barOf({ '/deberes': true }, true)).toContain('Deberes');
});

test('a section turned off, out of the bar; the rest as they were', () => {
	expect(barOf({})).toContain('Recetas');
	expect(barOf({ '/recetas': false })).not.toContain('Recetas');
	expect(barOf({ '/recetas': false })).toContain('Nevera');
	expect(barOf({ '/series': false }, true)).not.toContain('Series');
	expect(sectionOn('/nevera')).toBe(true);
	expect(sectionOn('/nevera', { '/nevera': false })).toBe(false);
});

test('Oración goes by its own on or off, not by the choices', () => {
	expect(barOf({ '/oracion': true })).not.toContain('Oración');
	const on = navLinks(false, true, false, false, true, { '/oracion': false });
	expect(on.links.map((l) => l.label)).toContain('Oración');
});

test("Ajustes' list: without a house, nothing of it; Oración, its own", () => {
	const paths = (hasHouse: boolean) => sectionList(hasHouse, {}, false).map((s) => s.path);
	expect(paths(true)).toContain('/deberes');
	expect(paths(false)).not.toContain('/deberes');
	expect(paths(false)).not.toContain('/series');
	expect(paths(false)).toContain('/recetas');
	const on = (path: string, prayer: boolean) =>
		sectionList(true, {}, prayer).find((s) => s.path === path)?.on;
	expect(on('/oracion', true)).toBe(true);
	expect(on('/oracion', false)).toBe(false);
	expect(on('/deberes', false)).toBe(false);
	expect(on('/recetas', false)).toBe(true);
});

test('saved: what the form showed; a house section without a house, as it was', () => {
	const after = savedSections(false, { '/deberes': true, '/recetas': false }, ['/recetas']);
	expect(after['/deberes']).toBe(true);
	expect(after['/recetas']).toBe(true);
	expect(after['/nevera']).toBe(false);
	expect(after['/oracion']).toBeUndefined();
	expect(savedSections(true, { '/deberes': true }, [])['/deberes']).toBe(false);
});

test('Juegos (#405): with a house, off until the family turns it on, and never for a child', () => {
	expect(barOf({})).not.toContain('Juegos');
	expect(barOf({ '/juegos': true })).toContain('Juegos');
	expect(barOf({ '/juegos': true }, true)).not.toContain('Juegos');
	const noHouse = navLinks(false, false, false, false, false, { '/juegos': true });
	expect(noHouse.links.map((l) => l.label)).not.toContain('Juegos');
});

const myBar = (family: Record<string, boolean>, mine: Record<string, boolean>, kid = false) =>
	navLinks(false, true, kid, false, false, family, mine).links.map((l) => l.label);

test('«Mi barra»: an adult takes a section out of their own bar; the family still has it', () => {
	expect(myBar({}, { '/recetas': false })).not.toContain('Recetas');
	expect(myBar({}, { '/recetas': false })).toContain('Nevera');
	expect(myBar({}, {})).toContain('Recetas');
	expect(sectionOn('/nevera', {}, { '/nevera': false })).toBe(false);
	expect(sectionOn('/nevera', { '/nevera': false }, { '/nevera': true })).toBe(false);
});

test('«Mi barra» cannot bring what the family does not have; a child goes by the family', () => {
	expect(myBar({}, { '/juegos': true })).not.toContain('Juegos');
	expect(myBar({ '/juegos': true }, {})).toContain('Juegos');
	expect(myBar({}, { '/series': false }, true)).toContain('Series');
});

test('Oración: on for the family, each adult may still take it out of their bar', () => {
	const bar = (mine: Record<string, boolean>) =>
		navLinks(false, true, false, false, true, {}, mine).links.map((l) => l.label);
	expect(bar({})).toContain('Oración');
	expect(bar({ '/oracion': false })).not.toContain('Oración');
	expect(
		navLinks(false, true, false, false, false, {}, { '/oracion': true }).links.map((l) => l.label)
	).not.toContain('Oración');
});

test("«Mi barra»'s list: only what the family has; saved, only what it showed", () => {
	const list = mySectionList(true, { '/recetas': false }, false, { '/nevera': false });
	const paths = list.map((s) => s.path);
	expect(paths).not.toContain('/recetas');
	expect(paths).not.toContain('/juegos');
	expect(paths).not.toContain('/oracion');
	expect(list.find((s) => s.path === '/nevera')?.on).toBe(false);
	expect(list.find((s) => s.path === '/agenda')?.on).toBe(true);
	expect(mySectionList(false, {}, true, {}).map((s) => s.path)).not.toContain('/series');
	expect(mySectionList(false, {}, true, {}).map((s) => s.path)).toContain('/oracion');

	const after = savedMine(
		{ '/recetas': false, '/nevera': false },
		['/nevera', '/agenda'],
		['/nevera']
	);
	expect(after).toEqual({ '/recetas': false, '/nevera': true, '/agenda': false });
});
