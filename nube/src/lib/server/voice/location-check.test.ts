import { describe, expect, test } from 'bun:test';
import { locationCheck } from './location-check.ts';

describe('sending one’s location by voice (#550)', () => {
	test('the first order asks; its answer sends', () => {
		const t = 1_000_000;
		expect(locationCheck('f:a', 'manda mi ubicación a mamá', 'm:false', '¿A mamá?', t)).toContain(
			'¿A mamá?'
		);
		expect(
			locationCheck('f:a', 'sí, manda mi ubicación a mamá', 'm:false', '¿A mamá?', t + 5000)
		).toBe(null);
		// Used: the next one asks again.
		expect(locationCheck('f:a', 'otra vez', 'm:false', '¿A mamá?', t + 6000)).not.toBe(null);
	});

	test('the same order again, another person or kind, or too late: it asks again', () => {
		const t = 2_000_000;
		locationCheck('f:b', 'manda mi ubicación a mamá', 'm:false', '?', t);
		expect(locationCheck('f:b', 'manda mi ubicación a mamá', 'm:false', '?', t + 1000)).not.toBe(
			null
		);
		expect(locationCheck('f:b', 'sí, a papá', 'p:false', '?', t + 2000)).not.toBe(null);
		expect(locationCheck('f:b', 'sí, en vivo', 'p:true', '?', t + 3000)).not.toBe(null);
		expect(locationCheck('f:b', 'sí', 'p:true', '?', t + 3000 + 3 * 60_000)).not.toBe(null);
	});
});
