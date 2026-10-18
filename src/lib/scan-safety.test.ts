import { expect, test } from 'bun:test';
import { looksUnmounted } from './scan-safety.ts';

test('looksUnmounted: almost nothing of many, not a few gone', () => {
	expect(looksUnmounted(0, 500)).toBe(true);
	expect(looksUnmounted(30, 500)).toBe(true);
	expect(looksUnmounted(400, 500)).toBe(false);
	// A small library that is really emptied: no way to tell, so it is believed.
	expect(looksUnmounted(0, 5)).toBe(false);
});
