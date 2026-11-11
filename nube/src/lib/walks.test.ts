import { describe, expect, test } from 'bun:test';
import { addPoints, type TripPoint } from '#lib/trips.ts';
import {
	FASTEST_WALK,
	clockText,
	dueCue,
	goalLeftText,
	mondayOf,
	noCues,
	noDiagnosis,
	parsePlan,
	spokenDistance,
	spokenTime,
	paceText,
	parseWalk,
	walkDistanceText,
	walkTotals,
	worthWalking,
	photoCopyName
} from '#lib/walks.ts';

const at = (north: number, t = 0): TripPoint => ({
	t,
	at: [-1.1, 37.9 + north / 111_195],
	speed: null
});

describe('which positions a walk keeps', () => {
	test('the first, if good enough', () => {
		expect(worthWalking(null, at(0), 10)).toBe(true);
		expect(worthWalking(null, at(0), 31)).toBe(false);
	});
	test('not closer than ten metres, nor than its own error', () => {
		expect(worthWalking(at(0), at(8), 5)).toBe(false);
		expect(worthWalking(at(0), at(12), 5)).toBe(true);
		expect(worthWalking(at(0), at(12), 20)).toBe(false);
		expect(worthWalking(at(0), at(22), 20)).toBe(true);
	});
	test('a jump of the GPS adds nothing, but a long gap counts as a straight line', () => {
		const jump = addPoints(null, [at(0, 0), at(500, 5_000), at(30, 20_000)], FASTEST_WALK);
		expect(jump.kept).toHaveLength(2);
		expect(Math.round(jump.distance)).toBe(30);
		const gap = addPoints(null, [at(0, 0), at(500, 600_000)], FASTEST_WALK);
		expect(Math.round(gap.distance)).toBe(500);
	});
});

describe('a finished walk sent by the browser', () => {
	const good = { startedAt: 1000, endedAt: 2000, points: [at(0, 1500)], diagnosis: noDiagnosis() };
	test('kept with its good positions and gaps', () => {
		const gap = { at: 1, seconds: 40, metres: 3, hidden: true, music: false, reopened: false };
		const walk = parseWalk({
			...good,
			points: [at(0, 1500), { t: 'x' }],
			diagnosis: { ...noDiagnosis(), gaps: [gap, { at: 'y' }] }
		});
		expect(walk?.points).toHaveLength(1);
		expect(walk?.diagnosis.gaps).toEqual([gap]);
		expect(walk?.startedAt).toEqual(new Date(1000));
	});
	test('refused if it is not one', () => {
		expect(parseWalk(null)).toBeNull();
		expect(parseWalk({ ...good, endedAt: 500 })).toBeNull();
		expect(parseWalk({ ...good, points: 'no' })).toBeNull();
		expect(parseWalk({ ...good, diagnosis: undefined })).toBeNull();
	});
});

describe('how it reads', () => {
	test('distance', () => {
		expect(walkDistanceText(850.4)).toBe('850 m');
		expect(walkDistanceText(3420)).toBe('3,42 km');
	});
	test('clock', () => {
		expect(clockText(65)).toBe('1:05');
		expect(clockText(3725)).toBe('1:02:05');
	});
	test('pace, once it means something', () => {
		expect(paceText(30, 60)).toBeNull();
		expect(paceText(1000, 690)).toBe('11:30 min/km');
	});
});

describe('totals', () => {
	test('a week starts on Monday, also from a Sunday and across months', () => {
		expect(mondayOf('2026-11-05')).toBe('2026-11-02');
		expect(mondayOf('2026-11-02')).toBe('2026-11-02');
		expect(mondayOf('2026-11-01')).toBe('2026-10-26');
	});
	test('this week and this month', () => {
		const w = (day: string) => ({ day, distance: 1000, seconds: 600 });
		const totals = walkTotals(
			[w('2026-11-05'), w('2026-11-02'), w('2026-11-01'), w('2026-10-31')],
			'2026-11-05'
		);
		expect(totals.week).toEqual({ walks: 2, distance: 2000, seconds: 1200 });
		expect(totals.month).toEqual({ walks: 3, distance: 3000, seconds: 1800 });
	});
});

describe('voice cues', () => {
	const plan = (over = {}) => ({ every: null, goal: null, ...over });

	test('nothing chosen, nothing said', () => {
		expect(dueCue(plan(), noCues(), 5000, 3000).text).toBeNull();
	});

	test('each km once, not the ones passed one by one', () => {
		const km = plan({ every: 'km' });
		expect(dueCue(km, noCues(), 900, 600).text).toBeNull();
		const first = dueCue(km, noCues(), 1040, 720);
		expect(first.text).toBe('1 kilómetro, 12 minutos.');
		expect(dueCue(km, first.cues, 1500, 900).text).toBeNull();
		const late = dueCue(km, first.cues, 3210, 2000);
		expect(late.text).toBe('3,2 kilómetros, 33 minutos.');
		expect(late.cues.marks).toBe(3);
	});

	test('every some minutes', () => {
		const every = plan({ every: '10min' });
		expect(dueCue(every, noCues(), 700, 599).text).toBeNull();
		expect(dueCue(every, noCues(), 780, 601).text).toBe('10 minutos, 780 metros.');
	});

	test('a goal by time: its half and its end, once each, with no periodic cues', () => {
		const goal = plan({ goal: { kind: 'minutes', value: 30 } });
		expect(dueCue(goal, noCues(), 1000, 899).text).toBeNull();
		const half = dueCue(goal, noCues(), 1000, 900);
		expect(half.text).toContain('Puedes dar la vuelta');
		expect(dueCue(goal, half.cues, 1100, 950).text).toBeNull();
		const end = dueCue(goal, half.cues, 2400, 1800);
		expect(end.text).toBe('Objetivo conseguido: 30 minutos, 2,4 kilómetros.');
		expect(dueCue(goal, end.cues, 2500, 1900).text).toBeNull();
	});

	test('a goal by km, reached with a km mark: the goal is said, the mark not again', () => {
		const goal = plan({ every: 'km', goal: { kind: 'km', value: 2 } });
		const half = dueCue(goal, noCues(), 1000, 700);
		expect(half.text).toContain('Mitad');
		expect(half.cues.marks).toBe(1);
		const end = dueCue(goal, half.cues, 2000, 1400);
		expect(end.text).toContain('Objetivo conseguido');
		expect(dueCue(goal, end.cues, 2100, 1450).text).toBeNull();
	});

	test('reached late, its half is not said after it', () => {
		const goal = plan({ goal: { kind: 'km', value: 2 } });
		const end = dueCue(goal, noCues(), 2500, 1500);
		expect(end.text).toContain('Objetivo conseguido');
		expect(dueCue(goal, end.cues, 2600, 1600).text).toBeNull();
	});

	test('said to be heard', () => {
		expect(spokenDistance(804)).toBe('800 metros');
		expect(spokenDistance(2000)).toBe('2 kilómetros');
		expect(spokenTime(60)).toBe('1 minuto');
		expect(spokenTime(3900)).toBe('1 hora y 5 minutos');
		expect(spokenTime(7200)).toBe('2 horas');
	});

	test('what is left of the goal', () => {
		expect(goalLeftText({ kind: 'minutes', value: 30 }, 0, 1081)).toBe('Faltan 12 min');
		expect(goalLeftText({ kind: 'km', value: 2 }, 800, 0)).toBe('Faltan 1,20 km');
		expect(goalLeftText({ kind: 'km', value: 2 }, 2000, 0)).toBeNull();
	});

	test('a plan kept on the device, as far as it is valid', () => {
		expect(parsePlan(null)).toEqual(plan());
		expect(parsePlan({ every: 'nunca', goal: { kind: 'km', value: 7 }, list: 'x' })).toEqual(
			plan()
		);
		expect(parsePlan({ every: 'km', goal: { kind: 'km', value: 5 }, list: 3 })).toEqual({
			every: 'km',
			goal: { kind: 'km', value: 5 }
		});
	});
});

test('photoCopyName: by when it was taken, with its own extension', () => {
	const at = new Date(2026, 10, 6, 9, 5, 7);
	expect(photoCopyName(at, 'IMG_1.JPG')).toBe('paseo-2026-11-06-09-05-07.jpg');
	expect(photoCopyName(at, 'foto.heic')).toBe('paseo-2026-11-06-09-05-07.heic');
	expect(photoCopyName(at, 'sin-extension')).toBe('paseo-2026-11-06-09-05-07.jpg');
});
