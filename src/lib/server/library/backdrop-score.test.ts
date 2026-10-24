import { describe, expect, test } from 'bun:test';
import { backdropScore } from './backdrop-score.ts';

describe('choosing a frame for the background', () => {
	test('colourful beats grey', () => {
		expect(backdropScore({ brightness: 120, colour: 80 })).toBeGreaterThan(
			backdropScore({ brightness: 120, colour: 20 })
		);
	});

	test('a dark scene or a white screen come last, however colourful', () => {
		const fine = backdropScore({ brightness: 110, colour: 40 });
		expect(backdropScore({ brightness: 30, colour: 90 })).toBeLessThan(fine);
		expect(backdropScore({ brightness: 230, colour: 60 })).toBeLessThan(fine);
	});

	test('a frame ffmpeg could not read is never chosen', () => {
		expect(backdropScore({ brightness: NaN, colour: NaN })).toBe(-Infinity);
	});
});
