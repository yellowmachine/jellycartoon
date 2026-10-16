import { describe, expect, test } from 'bun:test';
import { LIMIT_MS, nextStep, START_LIMIT_MS } from './update-progress.ts';

const at = (elapsedMs: number, wentDown = false) => ({ target: '1.0.7', wentDown, elapsedMs });

describe('nextStep', () => {
	test('the old version answering, at first: still preparing (copy, download)', () => {
		expect(nextStep('1.0.6', at(10_000))).toEqual({ kind: 'wait', stage: 'preparing' });
	});

	test('nothing answers: restarting', () => {
		expect(nextStep(null, at(40_000, true))).toEqual({ kind: 'wait', stage: 'restarting' });
	});

	test('the new version answers: done', () => {
		expect(nextStep('1.0.7', at(60_000, true))).toEqual({ kind: 'done' });
		// Also if no check fell in the seconds it was down.
		expect(nextStep('1.0.7', at(60_000))).toEqual({ kind: 'done' });
	});

	test('the old one again after going down: WUD went back to it', () => {
		const step = nextStep('1.0.6', at(90_000, true));
		expect(step.kind).toBe('failed');
		expect(step.kind === 'failed' && step.message).toContain('sigue la 1.0.6');
	});

	test('still the old one, never down, after five minutes: it did not start', () => {
		const step = nextStep('1.0.6', at(START_LIMIT_MS + 1));
		expect(step.kind === 'failed' && step.message).toContain('no ha empezado');
	});

	test('down for too long: it gives up', () => {
		expect(nextStep(null, at(LIMIT_MS + 1, true)).kind).toBe('failed');
		expect(nextStep(null, at(LIMIT_MS - 1, true)).kind).toBe('wait');
	});
});
