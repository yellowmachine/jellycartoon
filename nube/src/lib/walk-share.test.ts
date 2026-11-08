import { describe, expect, test } from 'bun:test';
import type { StoredPoint } from '#lib/trips.ts';
import { isPreviewBot, sharedPieces, sharedPlace, sharedTitle } from './walk-share.ts';

/** About 11 m a step north of (-1.13, 37.98): a way out and back home, 100 steps out. */
const step = 0.0001;
const out: StoredPoint[] = Array.from({ length: 100 }, (_, i) => [-1.13, 37.98 + i * step, i]);
const loop: StoredPoint[] = [
	...out,
	...out.toReversed().map((p, i): StoredPoint => [p[0], p[1], 100 + i])
];

describe('a shared walk (#434)', () => {
	test('untrimmed: the whole way, without the hours', () => {
		const pieces = sharedPieces(out, false);
		expect(pieces).toHaveLength(1);
		expect(pieces[0]).toHaveLength(100);
		expect(pieces[0]![0]).toEqual([-1.13, 37.98]);
	});

	test('trimmed: nothing within 250 m of where it started or ended', () => {
		const pieces = sharedPieces(loop, true);
		expect(pieces.length).toBeGreaterThan(0);
		for (const p of pieces.flat()) expect(p[1] - 37.98).toBeGreaterThan(0.00224);
	});

	test('trimmed, a short walk near home: no way at all', () => {
		expect(sharedPieces(out.slice(0, 10), true)).toEqual([]);
		expect(sharedPieces([], true)).toEqual([]);
	});

	test('a photo near home loses its place; one far keeps it', () => {
		expect(sharedPlace(loop, true, { lon: -1.13, lat: 37.9801 })).toEqual({ lon: null, lat: null });
		expect(sharedPlace(loop, true, { lon: -1.13, lat: 37.9899 })).toEqual({
			lon: -1.13,
			lat: 37.9899
		});
		expect(sharedPlace(loop, false, { lon: -1.13, lat: 37.9801 })).toEqual({
			lon: -1.13,
			lat: 37.9801
		});
	});

	test('its preview: first name and km, never where', () => {
		expect(sharedTitle('Miguel Ángel Alarcos', '5,2 km')).toBe('Paseo de Miguel · 5,2 km');
		expect(sharedTitle(null, '800 m')).toBe('Un paseo · 800 m');
	});

	test('link previews are not someone opening it', () => {
		expect(isPreviewBot('WhatsApp/2.23.20.0 A')).toBe(true);
		expect(isPreviewBot('TelegramBot (like TwitterBot)')).toBe(true);
		expect(isPreviewBot('Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36')).toBe(
			false
		);
	});
});
