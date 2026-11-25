import { describe, expect, test } from 'bun:test';
import { askedOf, assistantName, completed } from './mention.ts';

describe('calling the AI in Mensajes (#555)', () => {
	test('by @ anywhere, or by its name and a comma at the start', () => {
		expect(askedOf('@makoto búscame la receta de tarta', 'Makoto')).toBe(
			'búscame la receta de tarta'
		);
		expect(askedOf('búscame una tarta @Makoto', 'Makoto')).toBe('búscame una tarta');
		expect(askedOf('@makoto, una lista para la playa', 'Makoto')).toBe('una lista para la playa');
		expect(askedOf('Makoto, mándale la receta', 'Makoto')).toBe('mándale la receta');
		expect(askedOf('makoto: una tarta', 'Makoto')).toBe('una tarta');
		expect(askedOf('@ia una tarta', 'Makoto')).toBe('una tarta');
	});

	test('not when it is only a word, an email or another name', () => {
		expect(askedOf('Hola, ¿qué tal?', 'Makoto')).toBeNull();
		expect(askedOf('he visto a Makoto, el del cole', 'Makoto')).toBeNull();
		expect(askedOf('escribe a ana@makoto.es', 'Makoto')).toBeNull();
		expect(askedOf('@makotos hola', 'Makoto')).toBeNull();
		expect(askedOf('@iago ven', 'Makoto')).toBeNull();
	});

	test('its name: the wake word', () => {
		expect(assistantName('makoto')).toBe('Makoto');
		expect(assistantName('hola_casita')).toBe('Casita');
		expect(askedOf('@casita una tarta', assistantName('hola_casita'))).toBe('una tarta');
		const alizee = assistantName('oye_alizee');
		expect(alizee).toBe('Alizée');
		for (const text of [
			'@alizee una tarta',
			'@Alizée una tarta',
			'Alizée, una tarta',
			'alizee: una tarta'
		])
			expect(askedOf(text, alizee)).toBe('una tarta');
		expect(completed('@ali', alizee)).toBe('@alizee ');
	});

	test('«@ma» is finished as «@makoto »', () => {
		expect(completed('@', 'Makoto')).toBe('@makoto ');
		expect(completed('oye @Ma', 'Makoto')).toBe('oye @makoto ');
		expect(completed('@makoto', 'Makoto')).toBeNull();
		expect(completed('@pe', 'Makoto')).toBeNull();
		expect(completed('correo@', 'Makoto')).toBeNull();
	});
});
