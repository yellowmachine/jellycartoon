import { describe, expect, test } from 'bun:test';
import { toWav } from 'comun/wakeword-recorder.ts';
import { isSampleWav, maxBytes, speakerSlug } from '#lib/wakeword-samples.ts';

describe('speakerSlug', () => {
	test('a name as a folder', () => {
		expect(speakerSlug('Lucía (6)')).toBe('lucia_6');
		expect(speakerSlug('  Papá ')).toBe('papa');
		expect(speakerSlug('../../etc')).toBe('etc');
		expect(speakerSlug('¿?')).toBe('');
	});
});

describe('isSampleWav', () => {
	test("the page's takes", () => {
		expect(isSampleWav(toWav(new Int16Array(40_000)))).toBe(true);
	});
	test('not another rate, nor anything else', () => {
		const wav = toWav(new Int16Array(1000));
		new DataView(wav.buffer).setUint32(24, 48_000, true);
		expect(isSampleWav(wav)).toBe(false);
		expect(
			isSampleWav(new TextEncoder().encode('RIFF....WAVEfmt nothing here at all, really'))
		).toBe(false);
		expect(isSampleWav(toWav(new Int16Array(200_000)))).toBe(false);
	});
	test('30 s of «fondo», with its own limit', () => {
		const wav = toWav(new Int16Array(30 * 16_000));
		expect(isSampleWav(wav)).toBe(false);
		expect(isSampleWav(wav, maxBytes('fondo'))).toBe(true);
	});
});
