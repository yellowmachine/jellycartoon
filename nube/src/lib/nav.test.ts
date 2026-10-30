import { expect, test } from 'bun:test';
import { navLinks } from './nav.ts';

test('without a house connected, nothing of it in the bar', () => {
	const { links, menuLinks, userLinks } = navLinks(null, false, false);
	const labels = links.map((l) => l.label);
	expect(labels).not.toContain('Series');
	expect(labels).not.toContain('Música');
	expect(labels).not.toContain('Cine');
	expect(labels).toContain('Recetas');
	expect(links.some((l) => l.external || l.href.startsWith('/en-casa'))).toBe(false);
	expect(menuLinks.map((l) => l.label)).not.toContain('Gestión');
	expect(userLinks.map((l) => l.label)).toEqual(['Buzón', 'Ajustes']);
});

test('with a house, its sections, at its address', () => {
	const { links, userLinks } = navLinks('https://casa.example', false, true);
	expect(links.find((l) => l.label === 'Cine')).toMatchObject({
		href: 'https://casa.example/cine',
		external: true
	});
	expect(links.find((l) => l.label === 'Series')?.href).toBe('/series');
	expect(userLinks.map((l) => l.label)).toEqual(['Buzón', 'Ajustes', 'Gestión', 'Vista TV']);
});
