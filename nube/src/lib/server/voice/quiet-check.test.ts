import { describe, expect, test } from 'bun:test';
import { inQuietHours, quietCheck } from './quiet-check.ts';

const hhmm = (minute: number) =>
	`${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

describe('inQuietHours', () => {
	test('past midnight', () => {
		const night = { from: '23:00', to: '07:00' };
		expect(inQuietHours(night, 23 * 60)).toBe(true);
		expect(inQuietHours(night, 4 * 60 + 41)).toBe(true);
		expect(inQuietHours(night, 7 * 60)).toBe(false);
		expect(inQuietHours(night, 16 * 60 + 41)).toBe(false);
	});
	test('within a day', () => {
		const siesta = { from: '15:00', to: '17:00' };
		expect(inQuietHours(siesta, 15 * 60 + 30)).toBe(true);
		expect(inQuietHours(siesta, 14 * 60 + 59)).toBe(false);
	});
});

describe('quietCheck', () => {
	// Hours around now, and hours far from it.
	const minute = 3 * 60;
	const around = { from: hhmm(minute + 24 * 60 - 60), to: hhmm(minute + 60) };
	const away = { from: hhmm(minute + 120), to: hhmm(minute + 180) };

	test('outside the hours, or none, it plays', () => {
		expect(quietCheck(null, 'a', 'o1', minute)).toBeNull();
		expect(quietCheck(away, 'a', 'o1', minute)).toBeNull();
	});
	test('asks first, and plays with the answer in another order', () => {
		expect(quietCheck(around, 'b', 'o1', minute)).toContain('horas de silencio');
		// The same order cannot answer its own question.
		expect(quietCheck(around, 'b', 'o1', minute)).toContain('horas de silencio');
		expect(quietCheck(around, 'b', 'o2', minute)).toBeNull();
		// And for a while, the next ones too.
		expect(quietCheck(around, 'b', 'o3', minute)).toBeNull();
	});
	test('one place answering does not let another play', () => {
		quietCheck(around, 'c', 'o1', minute);
		expect(quietCheck(around, 'd', 'o2', minute)).toContain('horas de silencio');
	});
});
