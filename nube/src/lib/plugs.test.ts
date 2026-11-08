import { describe, expect, test } from 'bun:test';
import { plugNamed } from '#lib/plugs.ts';

/** «Enciende la lámpara» (#396): which plug is meant. */
const plug = (name: string) => ({ id: name, name });
const plugs = [plug('Lámpara del salón'), plug('Lámpara'), plug('Termo'), plug('Lavadora')];

describe('plugs by voice', () => {
	test('its name, without accents or capitals', () => {
		expect(plugNamed(plugs, 'lampara')!.id).toBe('Lámpara');
		expect(plugNamed(plugs, 'TERMO')!.id).toBe('Termo');
	});

	test('part of its name, if only one has it', () => {
		expect(plugNamed(plugs, 'salón')!.id).toBe('Lámpara del salón');
		expect(plugNamed(plugs, 'la lavadora')!.id).toBe('Lavadora');
	});

	test('none, or not clear: none', () => {
		expect(plugNamed(plugs, 'tele')).toBeNull();
		expect(plugNamed(plugs, '')).toBeNull();
		expect(plugNamed([plug('Lámpara roja'), plug('Lámpara azul')], 'lámpara')).toBeNull();
	});
});
