import { expect, test } from 'bun:test';
import { DAY_SHAPE } from './day-shape.ts';
import { madeIn, runSolar, solarDays, usedIn, type SolarSetup } from './solar.ts';

const setup = (over: Partial<SolarSetup> = {}): SolarSetup => ({
	groups: [{ kwp: 4, tilt: 30, azimuth: 0 }],
	inverterKw: null,
	batteryKwh: null,
	reserve: 10,
	...over
});

/** A day of sun from 9 to 17 (8 hours), `peak` W/m² all of them. */
const sunnyDay = (day: string, peak: number) =>
	Array.from({ length: 24 }, (_, hour) => ({ day, hour, wm2: hour >= 9 && hour < 17 ? peak : 0 }));

const hoursOf = (s: SolarSetup, days: { day: string; peak: number; use: number }[]) =>
	days.flatMap((d) =>
		sunnyDay(d.day, d.peak).map((h) => ({
			day: h.day,
			hour: h.hour,
			made: madeIn(s, [h.wm2]),
			used: usedIn(h, d.use)
		}))
	);

test('the day shape: each month adds up to 1, more at night than at 5 in the morning', () => {
	for (const month of DAY_SHAPE) {
		expect(month).toHaveLength(24);
		expect(month.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 3);
		expect(month[21]!).toBeGreaterThan(month[5]!);
	}
});

test('made: kWp × sun × performance, each group its own sun, cut at the inverter', () => {
	const two = setup({
		groups: [
			{ kwp: 3, tilt: 30, azimuth: -90 },
			{ kwp: 3, tilt: 30, azimuth: 90 }
		]
	});
	expect(madeIn(two, [1000, 500])).toBeCloseTo(3 * 0.8 + 1.5 * 0.8);
	expect(madeIn({ ...two, inverterKw: 3 }, [1000, 1000])).toBe(3);
});

test('used: the day spread as a Spanish home does, the whole day is what was said', () => {
	const day = Array.from({ length: 24 }, (_, hour) => usedIn({ day: '2026-01-10', hour }, 10));
	expect(day.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 2);
	expect(day[21]!).toBeGreaterThan(day[4]!);
});

test('without a battery: what is left over goes to the grid, the night from it', () => {
	const s = setup();
	const [d] = solarDays(s, runSolar(s, hoursOf(s, [{ day: '2026-11-16', peak: 600, use: 10 }])));
	expect(d!.made).toBeCloseTo(4 * 0.6 * 0.8 * 8); // 15.36
	// Made − used = sent − taken, nothing kept.
	expect(d!.toGrid - d!.fromGrid).toBeCloseTo(d!.made - d!.used, 6);
	expect(d!.fromGrid).toBeGreaterThan(5); // the night, and the morning
	expect(d!.full).toBe(false);
	expect(d!.emptyAt).toBeNull();
	// 1.92 kW made against about 0.4 used: spare all the 8 hours of sun.
	expect(d!.spare).toMatchObject({ from: 9, to: 17 });
});

test('a battery big enough carries the night; a small one runs out, and when', () => {
	const big = setup({ batteryKwh: 15 });
	const sunny = [
		{ day: '2026-11-16', peak: 600, use: 10 },
		{ day: '2026-11-17', peak: 600, use: 10 }
	];
	const bigDays = solarDays(big, runSolar(big, hoursOf(big, sunny)));
	expect(bigDays[0]!.emptyAt).toBeNull();
	expect(bigDays[0]!.fromGrid).toBeCloseTo(0, 6);

	const small = setup({ batteryKwh: 3 });
	const smallDays = solarDays(small, runSolar(small, hoursOf(small, sunny)));
	expect(smallDays[0]!.full).toBe(true);
	// 2.7 kWh usable (10 % kept) against about 6 kWh of evening and night: out in the evening.
	expect(smallDays[0]!.emptyAt).toBeGreaterThanOrEqual(17);
	expect(smallDays[0]!.fromGrid).toBeGreaterThan(1);
});

test('a cloudy day after a sunny one: the battery empties, nothing to spare', () => {
	const s = setup({ batteryKwh: 10 });
	const days = solarDays(
		s,
		runSolar(
			s,
			hoursOf(s, [
				{ day: '2026-11-16', peak: 600, use: 10 },
				{ day: '2026-11-17', peak: 60, use: 10 }
			])
		)
	);
	expect(days[0]!.spare).not.toBeNull();
	expect(days[1]!.spare).toBeNull();
	expect(days[1]!.full).toBe(false);
	expect(days[1]!.fromGrid).toBeGreaterThan(days[0]!.fromGrid);
	// Kept the energy: made + taken = used + sent + what the battery gained, less its losses.
	const all = days.reduce(
		(s, d) => ({ in: s.in + d.made + d.fromGrid, out: s.out + d.used + d.toGrid }),
		{ in: 0, out: 0 }
	);
	expect(all.in).toBeGreaterThanOrEqual(all.out - 10);
});
