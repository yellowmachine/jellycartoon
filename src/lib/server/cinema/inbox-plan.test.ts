import { describe, expect, test } from 'bun:test';
import {
	cpuTicks,
	frameRate,
	isTemp,
	othersCores,
	processTicks,
	progressSeconds,
	sameLength,
	SETTLE_MS,
	settled,
	targetOf,
	tempOf
} from './inbox-plan.ts';

describe('settled', () => {
	const at = 1_000_000_000;
	test('old and the same size as before: done', () => {
		expect(settled({ size: 10, mtimeMs: at - SETTLE_MS }, { size: 10, mtimeMs: 0 }, at)).toBe(true);
	});
	test('first look: not yet', () => {
		expect(settled({ size: 10, mtimeMs: 0 }, undefined, at)).toBe(false);
	});
	test('growing with an old date (cp -p): not yet', () => {
		expect(settled({ size: 20, mtimeMs: 0 }, { size: 10, mtimeMs: 0 }, at)).toBe(false);
	});
	test('modified a moment ago: not yet', () => {
		expect(settled({ size: 10, mtimeMs: at - 1000 }, { size: 10, mtimeMs: 0 }, at)).toBe(false);
	});
});

describe('paths', () => {
	test('same path without entrada, .mkv when encoded', () => {
		expect(targetOf('Alien.mkv', true)).toBe('Alien.mkv');
		expect(targetOf('Alien/title_t00.mkv', true)).toBe('Alien/title_t00.mkv');
		expect(targetOf('Viejo.avi', false)).toBe('Viejo.avi');
	});
	test('the half-made file is hidden beside it', () => {
		const temp = tempOf('/cinema/entrada/Alien (1979).mkv');
		expect(temp).toBe('/cinema/entrada/.Alien (1979).codificando.mkv');
		expect(isTemp('.Alien (1979).codificando.mkv')).toBe(true);
		expect(isTemp('Alien.mkv')).toBe(false);
	});
});

test('sameLength: 1 % or 2 s', () => {
	expect(sameLength(7200, 7199)).toBe(true);
	expect(sameLength(7200, 7100)).toBe(false);
	expect(sameLength(60, 58.5)).toBe(true);
	expect(sameLength(7200, null)).toBe(false);
});

describe('CPU', () => {
	test('/proc/stat busy and total', () => {
		expect(cpuTicks('cpu  100 20 30 1000 50 5 5 0 0 0\ncpu0 1 2 3')).toEqual({
			busy: 160,
			total: 1210
		});
	});
	test('a process with spaces in its name', () => {
		const stat = '42 (ff mpeg) R 1 42 42 0 -1 4194560 100 0 0 0 700 300 0 0 39 19 16 0';
		expect(processTicks(stat)).toBe(1000);
	});
	test('the rest of the PC, without ours', () => {
		// 12 CPUs, 10 s at 100 ticks/s: 12000 ticks. Busy 7000, ours 6000: the rest used 1000 ticks, one CPU.
		const before = { busy: 0, total: 0, ours: 0 };
		expect(othersCores(before, { busy: 7000, total: 12000, ours: 6000 }, 12)).toBeCloseTo(1);
		expect(othersCores(before, { busy: 6000, total: 12000, ours: 6000 }, 12)).toBe(0);
		expect(othersCores(before, before, 12)).toBe(0);
	});
});

test('progress from the frames done', () => {
	expect(progressSeconds('frame=240\nout_time_us=1500000\nprogress=continue\n', 24)).toBe(10);
	expect(progressSeconds('frame=24\nfps=10\nframe=48\n', 24)).toBe(2);
	expect(progressSeconds('out_time_us=1000000\n', 24)).toBeNull();
	expect(frameRate('24000/1001')).toBeCloseTo(23.976);
	expect(frameRate('0/0')).toBeNull();
	expect(frameRate(undefined)).toBeNull();
});
