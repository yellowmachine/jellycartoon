import { describe, expect, test } from 'bun:test';
import {
	BACK_MS,
	isNight,
	REST_MS,
	REST_NIGHT_MS,
	shouldGoBack,
	shouldRest,
	shouldUpdateVista,
	UPDATE_MS
} from './vista-idle.ts';

const idle = (idleMs: number) => ({
	idleMs,
	videoPlaying: false,
	voiceBusy: false,
	ringing: false
});

describe('Vista (#525): resting and coming back', () => {
	test('rests after REST_MS untouched, not before', () => {
		expect(shouldRest(idle(REST_MS - 1))).toBe(false);
		expect(shouldRest(idle(REST_MS))).toBe(true);
	});
	test('goes back after BACK_MS untouched, not before', () => {
		expect(shouldGoBack(idle(REST_MS))).toBe(false);
		expect(shouldGoBack(idle(BACK_MS))).toBe(true);
	});
	test('a video, the voice or something ringing keep it as it is', () => {
		for (const busy of [{ videoPlaying: true }, { voiceBusy: true }, { ringing: true }]) {
			expect(shouldRest({ ...idle(BACK_MS * 10), ...busy })).toBe(false);
			expect(shouldGoBack({ ...idle(BACK_MS * 10), ...busy })).toBe(false);
		}
	});
	test('at night it rests sooner', () => {
		expect(shouldRest(idle(REST_NIGHT_MS), false)).toBe(false);
		expect(shouldRest(idle(REST_NIGHT_MS), true)).toBe(true);
	});
	test("night: the family's hours, or 23:00 to 07:00", () => {
		const at = (h: number, m = 0) => new Date(2026, 10, 18, h, m);
		expect(isNight(null, at(23, 30))).toBe(true);
		expect(isNight(null, at(6, 59))).toBe(true);
		expect(isNight(null, at(7))).toBe(false);
		expect(isNight({ from: '22:00', to: '08:00' }, at(22, 15))).toBe(true);
		expect(isNight({ from: '22:00', to: '08:00' }, at(7, 30))).toBe(true);
		expect(isNight({ from: '01:00', to: '06:00' }, at(23, 30))).toBe(false);
	});
});

describe('a new version in the Vista (#579)', () => {
	const quiet = (idleMs: number, more = {}) => ({ ...idle(idleMs), musicPlaying: false, ...more });

	test('untouched long enough and quiet: loaded', () => {
		expect(shouldUpdateVista(quiet(UPDATE_MS - 1))).toBe(false);
		expect(shouldUpdateVista(quiet(UPDATE_MS))).toBe(true);
	});

	test('not while anything plays, listens or rings', () => {
		expect(shouldUpdateVista(quiet(UPDATE_MS, { musicPlaying: true }))).toBe(false);
		expect(shouldUpdateVista(quiet(UPDATE_MS, { videoPlaying: true }))).toBe(false);
		expect(shouldUpdateVista(quiet(UPDATE_MS, { voiceBusy: true }))).toBe(false);
		expect(shouldUpdateVista(quiet(UPDATE_MS, { ringing: true }))).toBe(false);
	});
});
