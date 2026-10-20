import { describe, expect, test } from 'bun:test';
import { LIMIT_MS, nextStep, REST_LIMIT_MS, START_LIMIT_MS } from './update-progress.ts';

const at = (elapsedMs: number, wentDown = false) => ({ target: '1.0.7', wentDown, elapsedMs });

describe('nextStep', () => {
	test('the old version answering, at first: still preparing (copy, download)', () => {
		expect(nextStep('1.0.6', at(10_000))).toEqual({ kind: 'wait', stage: 'preparing' });
	});

	test('nothing answers: restarting', () => {
		expect(nextStep(null, at(40_000, true))).toEqual({ kind: 'wait', stage: 'restarting' });
	});

	test('the new version answers and WUD has nothing left: done', () => {
		expect(nextStep('1.0.7', { ...at(60_000, true), pending: 0 })).toEqual({ kind: 'done' });
		// Also if no check fell in the seconds it was down.
		expect(nextStep('1.0.7', { ...at(60_000), pending: 0 })).toEqual({ kind: 'done' });
		// WUD cannot say: nothing to wait for.
		expect(nextStep('1.0.7', { ...at(60_000), pending: null })).toEqual({ kind: 'done' });
	});

	test('the new version answers but WUD goes on with the rest (Caddy): finishing', () => {
		const finishing = { kind: 'wait', stage: 'finishing' } as const;
		expect(nextStep('1.0.7', { ...at(60_000, true), pending: 2, upForMs: 5_000 })).toEqual(
			finishing
		);
		// It could not be asked: Caddy restarting.
		expect(nextStep('1.0.7', { ...at(60_000, true), upForMs: 5_000 })).toEqual(finishing);
	});

	test('the rest taking too long: done all the same', () => {
		expect(
			nextStep('1.0.7', { ...at(300_000, true), pending: 1, upForMs: REST_LIMIT_MS + 1 })
		).toEqual({ kind: 'done' });
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
