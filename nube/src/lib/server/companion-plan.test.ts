import { describe, expect, test } from 'bun:test';
import {
	inHours,
	minutesToTomorrow,
	nextStep,
	OFFLINE_GRACE_MS,
	type CompanionState
} from './companion-plan.ts';

/** «Compañía» (#469): when the clock asks, asks again, tells the linked families or waits. */

const at = (h: number, m = 0, day = 11) => new Date(2026, 10, day, h, m);
const min = (n: number) => n * 60_000;

const base: CompanionState = {
	on: true,
	everyMinutes: 30,
	fromTime: '09:00',
	toTime: '22:00',
	retries: 2,
	retryMinutes: 2,
	pausedUntil: null,
	lastSignalAt: null,
	lastCheckAt: null,
	attempt: 0,
	askedAt: null,
	alertKind: null,
	offlineSince: null
};
const with_ = (s: Partial<CompanionState>): CompanionState => ({ ...base, ...s });

describe('inHours', () => {
	test('from 9 to 22', () => {
		expect(inHours(base, at(8, 59))).toBe(false);
		expect(inHours(base, at(9))).toBe(true);
		expect(inHours(base, at(21, 59))).toBe(true);
		expect(inHours(base, at(22))).toBe(false);
	});
	test('across midnight', () => {
		const night = { fromTime: '20:00', toTime: '02:00' };
		expect(inHours(night, at(23))).toBe(true);
		expect(inHours(night, at(1))).toBe(true);
		expect(inHours(night, at(12))).toBe(false);
	});
});

describe('nextStep', () => {
	test('off: nothing', () => {
		expect(nextStep(with_({ on: false }), 'ready', at(10))).toBe('none');
	});

	test('never asked: asks, but not at night', () => {
		expect(nextStep(base, 'ready', at(10))).toBe('ask');
		expect(nextStep(base, 'ready', at(23))).toBe('none');
	});

	test('the first of the day as the hours begin, even after a late sign', () => {
		expect(nextStep(with_({ lastCheckAt: at(21, 40, 10) }), 'ready', at(9))).toBe('ask');
		expect(nextStep(with_({ lastSignalAt: at(8, 50) }), 'ready', at(9))).toBe('ask');
	});

	test('every so often from the last sign or asking', () => {
		expect(nextStep(with_({ lastCheckAt: at(10) }), 'ready', at(10, 29))).toBe('none');
		expect(nextStep(with_({ lastCheckAt: at(10) }), 'ready', at(10, 30))).toBe('ask');
		// Said something to the satellite meanwhile: counts as a sign.
		expect(
			nextStep(with_({ lastCheckAt: at(10), lastSignalAt: at(10, 20) }), 'ready', at(10, 30))
		).toBe('none');
	});

	test('no answer: tries again after its minutes, then gives up', () => {
		const asking = with_({ attempt: 1, askedAt: at(10) });
		expect(nextStep(asking, 'ready', at(10, 1))).toBe('none');
		expect(nextStep(asking, 'ready', at(10, 2))).toBe('retry');
		expect(nextStep(with_({ attempt: 3, askedAt: at(10, 4) }), 'ready', at(10, 6))).toBe('give-up');
	});

	test('no retries: gives up after the first', () => {
		expect(nextStep(with_({ retries: 0, attempt: 1, askedAt: at(10) }), 'ready', at(10, 2))).toBe(
			'give-up'
		);
	});

	test('paused: nothing, and the asking going on is dropped', () => {
		const paused = { pausedUntil: at(12) };
		expect(nextStep(with_(paused), 'ready', at(10))).toBe('none');
		expect(nextStep(with_({ ...paused, attempt: 2, askedAt: at(9) }), 'ready', at(10))).toBe(
			'drop'
		);
		// The pause over: asked again.
		expect(nextStep(with_(paused), 'ready', at(12))).toBe('ask');
	});

	test('no satellite: told only after a while, and never at night', () => {
		expect(nextStep(base, 'none', at(10))).toBe('offline-start');
		const away = with_({ offlineSince: at(10) });
		expect(nextStep(away, 'none', new Date(at(10).getTime() + OFFLINE_GRACE_MS - 1))).toBe('none');
		expect(nextStep(away, 'none', new Date(at(10).getTime() + OFFLINE_GRACE_MS))).toBe(
			'offline-alert'
		);
		expect(nextStep(with_({ offlineSince: at(10), alertKind: 'offline' }), 'none', at(11))).toBe(
			'none'
		);
		expect(nextStep(base, 'none', at(23))).toBe('none');
		// An old image counts as none: it would say the question and never answer.
		expect(nextStep(base, 'old', at(10))).toBe('offline-start');
	});

	test('no satellite while asking: dropped, not counted as no answer', () => {
		expect(nextStep(with_({ attempt: 2, askedAt: at(10) }), 'none', at(10, 3))).toBe('drop');
	});

	test('back again: online first', () => {
		expect(nextStep(with_({ offlineSince: at(10) }), 'ready', at(10, 5))).toBe('online');
		expect(nextStep(with_({ alertKind: 'offline', offlineSince: at(9) }), 'ready', at(11))).toBe(
			'online'
		);
	});

	test('an open «no contesta» does not stop the asking', () => {
		expect(nextStep(with_({ alertKind: 'silent', lastCheckAt: at(10) }), 'ready', at(10, 30))).toBe(
			'ask'
		);
	});

	test('retry waits its minutes', () => {
		expect(
			nextStep(
				with_({ attempt: 1, askedAt: at(10) }),
				'ready',
				new Date(at(10).getTime() + min(2) - 1)
			)
		).toBe('none');
	});
});

test('minutesToTomorrow', () => {
	expect(minutesToTomorrow('09:00', at(21))).toBe(12 * 60);
	expect(minutesToTomorrow('09:00', at(8))).toBe(25 * 60);
});
