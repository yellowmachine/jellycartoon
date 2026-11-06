import { describe, expect, test } from 'bun:test';
import { heardElsewhere, TWIN_MS } from './order-twins.ts';

describe('the same order from two devices', () => {
	test('the second device is quiet; the first and a third order are not', () => {
		expect(heardElsewhere('a', 'tablet', 'Toma nota: llamar al fontanero', 1000)).toBe(false);
		expect(heardElsewhere('a', 'dormitorio', 'toma nota, llamar al fontanero.', 1500)).toBe(true);
		expect(heardElsewhere('a', 'dormitorio', '¿Qué hora es?', 1600)).toBe(false);
	});

	test('a transcript a little different is the same order', () => {
		expect(heardElsewhere('b', 'tablet', 'apunta comprar leche y huevos', 1000)).toBe(false);
		expect(heardElsewhere('b', 'dormitorio', 'apunta comprar leche y huevo', 1100)).toBe(true);
	});

	test('different numbers are different orders', () => {
		expect(heardElsewhere('c', 'tablet', 'pon un temporizador de 10 minutos', 1000)).toBe(false);
		expect(heardElsewhere('c', 'dormitorio', 'pon un temporizador de 15 minutos', 1100)).toBe(
			false
		);
	});

	test('the same device, or after the window, is another order', () => {
		expect(heardElsewhere('d', 'tablet', 'sube el volumen', 1000)).toBe(false);
		expect(heardElsewhere('d', 'tablet', 'sube el volumen', 1200)).toBe(false);
		expect(heardElsewhere('d', 'dormitorio', 'sube el volumen', 1200 + TWIN_MS)).toBe(false);
	});

	test('another family is not this one', () => {
		expect(heardElsewhere('e', 'tablet', 'pon música', 1000)).toBe(false);
		expect(heardElsewhere('f', 'dormitorio', 'pon música', 1000)).toBe(false);
	});

	test('a short different answer is not taken for the other', () => {
		expect(heardElsewhere('g', 'tablet', 'sí', 1000)).toBe(false);
		expect(heardElsewhere('g', 'dormitorio', 'no', 1000)).toBe(false);
	});
});
