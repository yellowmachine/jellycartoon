import { describe, expect, test } from 'bun:test';
import { aiKind } from './ai-spend.ts';

describe('aiKind', () => {
	test('each app’s labels, grouped', () => {
		expect(aiKind('Voz: «pon música»')).toBe('Voz');
		expect(aiKind('Voz, en internet: «el tiempo»')).toBe('Voz: buscar en internet');
		expect(aiKind('Leer un ticket')).toBe('Tickets');
		expect(aiKind('Pasos de «Carbonara»')).toBe('Recetas');
		expect(aiKind('Identificar la serie «Bluey»')).toBe('Series: identificar');
		expect(aiKind('Identificar «Tiburón»')).toBe('Cine: identificar');
		expect(aiKind('Títulos de «Bluey», lote 1 de 3')).toBe('Series: títulos de capítulos');
		expect(aiKind('Algo nuevo')).toBe('Otros');
	});
});
