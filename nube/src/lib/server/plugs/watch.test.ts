import { describe, expect, test } from 'bun:test';
import { PlugWatch, type WatchSettings } from './watch.ts';

/** What a plug's watts say (#396, phase 3), on a clock of its own. */
const ALL: WatchSettings = { done: true, stopped: true, offline: true, onHours: 1 };
const MIN = 60_000;

describe('plug watch', () => {
	test('a wash: working 40 minutes with pauses, then idle 3 minutes: done, once', () => {
		const w = new PlugWatch({ ...ALL, onHours: null }, 0);
		const said: string[] = [];
		const at = (m: number, power: number) => said.push(...w.seen(power, true, m * MIN));
		at(0, 2000);
		at(10, 300);
		// A pause to soak, shorter than 3 minutes.
		at(20, 2);
		at(22, 400);
		at(40, 1);
		expect(said).toEqual([]);
		said.push(...w.tick(42 * MIN));
		expect(said).toEqual([]);
		said.push(...w.tick(43 * MIN));
		expect(said).toEqual(['done']);
		said.push(...w.tick(60 * MIN));
		expect(said).toEqual(['done']);
	});

	test('a blip is not a cycle', () => {
		const w = new PlugWatch(ALL, 0);
		expect(w.seen(1500, true, 0)).toEqual([]);
		expect(w.seen(1, true, 2 * MIN)).toEqual([]);
		expect(w.tick(20 * MIN)).toEqual([]);
	});

	test('a fridge 3 hours without working: stopped, once; working again, it can be told again', () => {
		const w = new PlugWatch({ ...ALL, onHours: null }, 0);
		w.seen(80, true, 0);
		w.seen(1, true, 20 * MIN);
		expect(w.tick(3 * 60 * MIN)).toEqual([]);
		expect(w.tick(3 * 60 * MIN + 20 * MIN)).toEqual(['stopped']);
		expect(w.tick(5 * 60 * MIN)).toEqual([]);
		w.seen(90, true, 6 * 60 * MIN);
		expect(w.tick(9 * 60 * MIN + 1)).toEqual(['stopped']);
	});

	test('switched off on purpose: not stopped', () => {
		const w = new PlugWatch(ALL, 0);
		w.seen(0, false, 0);
		expect(w.tick(10 * 60 * MIN)).toEqual([]);
	});

	test('without connection 30 minutes: told once; back, it can be told again', () => {
		const w = new PlugWatch(ALL, 0);
		w.seen(80, true, 0);
		w.gone(MIN);
		expect(w.tick(30 * MIN)).toEqual([]);
		expect(w.tick(31 * MIN)).toEqual(['offline']);
		expect(w.tick(90 * MIN)).toEqual([]);
		w.seen(80, true, 100 * MIN);
		w.gone(101 * MIN);
		expect(w.tick(131 * MIN)).toEqual(['offline']);
	});

	test('on longer than its hours: told once, until switched off', () => {
		const w = new PlugWatch({ done: false, stopped: false, offline: false, onHours: 1 }, 0);
		w.seen(1000, true, 0);
		expect(w.tick(59 * MIN)).toEqual([]);
		expect(w.tick(60 * MIN)).toEqual(['longOn']);
		expect(w.tick(120 * MIN)).toEqual([]);
		w.seen(0, false, 121 * MIN);
		w.seen(1000, true, 122 * MIN);
		expect(w.tick(182 * MIN)).toEqual(['longOn']);
	});

	test('nothing asked, nothing said', () => {
		const w = new PlugWatch({ done: false, stopped: false, offline: false, onHours: null }, 0);
		w.seen(2000, true, 0);
		w.seen(1, true, 10 * MIN);
		w.gone(11 * MIN);
		expect(w.tick(10 * 60 * MIN)).toEqual([]);
	});
});
