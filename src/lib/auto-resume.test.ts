import { expect, test } from 'bun:test';
import { MAX_IN_A_ROW, shouldResume } from './auto-resume.ts';

const alone = { hidden: true, ended: false, loading: false, askedAt: 0, now: 100_000, inARow: 0 };

test('paused by itself with the screen off: played again', () => {
	expect(shouldResume(alone)).toBe(true);
});

test('not when someone can see it, at the end of a track or while the next one loads', () => {
	expect(shouldResume({ ...alone, hidden: false })).toBe(false);
	expect(shouldResume({ ...alone, ended: true })).toBe(false);
	expect(shouldResume({ ...alone, loading: true })).toBe(false);
});

test('a pause asked for (the app, the lock screen) is respected; one long after, not', () => {
	expect(shouldResume({ ...alone, askedAt: 99_500 })).toBe(false);
	expect(shouldResume({ ...alone, askedAt: 50_000 })).toBe(true);
});

test('a couple of times in a row at most: a call or another app keeps the sound', () => {
	expect(shouldResume({ ...alone, inARow: MAX_IN_A_ROW - 1 })).toBe(true);
	expect(shouldResume({ ...alone, inARow: MAX_IN_A_ROW })).toBe(false);
});
