import { expect, test } from 'bun:test';
import { navLinks } from './nav.ts';

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
	expect(userLinks.map((l) => l.label)).toEqual(['Buzón', 'Ajustes']);
});
