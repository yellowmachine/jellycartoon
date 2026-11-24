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

/** Labels each app gives its requests, in the files that make them. */
test('every request has its kind: none ends in «Otros»', async () => {
	const root = `${import.meta.dir}/../../..`;
	const labels: string[] = [];
	for (const dir of ['nube/src', 'src'])
		for await (const file of new Bun.Glob('**/*.ts').scan(`${root}/${dir}`)) {
			if (file.endsWith('.test.ts')) continue;
			const source = await Bun.file(`${root}/${dir}/${file}`).text();
			if (!/from '[^']*\/openrouter\.ts'/.test(source)) continue;
			for (const [, , label] of source.matchAll(/\blabel: (['`])([A-ZÁÉÍÓÚ][^'`]*)\1/g))
				labels.push(label!);
			// learn.ts's, through its `read`.
			for (const [, label] of source.matchAll(/\bread(?:<[^(]*>)?\(\s*k,\s*'([^']+)'/g))
				labels.push(label!);
		}
	// None found would mean this looks for them wrongly.
	expect(labels.length).toBeGreaterThan(25);
	expect(labels.filter((l) => aiKind(l) === 'Otros')).toEqual([]);
});
