import { describe, expect, test } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { inBackground, quietFor, throughLane } from './ai-lane.ts';

/** The voice's requests first; the background's behind them, one at a time (#331). */
describe('throughLane', () => {
	test('the background waits for the foreground and a moment more, and goes one at a time', async () => {
		const order: string[] = [];
		const job = (name: string, ms: number) => async () => {
			order.push(`${name}>`);
			await sleep(ms);
			order.push(`<${name}`);
			return name;
		};
		const voice = throughLane('k1', job('voz', 300));
		await sleep(10);
		const learn = inBackground(() => throughLane('k1', job('aprender', 50)));
		const rule = inBackground(() => throughLane('k1', job('regla', 50)));
		// Another family's key: its own lane, not waiting for this one's.
		const other = throughLane('k2', job('otra', 10));
		expect(await other).toBe('otra');
		expect(quietFor('k1')).toBe(0);
		expect(await Promise.all([voice, learn, rule])).toEqual(['voz', 'aprender', 'regla']);
		expect(order.filter((o) => !o.includes('otra'))).toEqual([
			'voz>',
			'<voz',
			'aprender>',
			'<aprender',
			'regla>',
			'<regla'
		]);
		expect(quietFor('k1')).toBeGreaterThanOrEqual(3_000);
	}, 15_000);

	test('a background one that fails does not stop the next', async () => {
		const failed = inBackground(() =>
			throughLane('k3', async () => {
				throw new Error('402');
			})
		);
		const next = inBackground(() => throughLane('k3', async () => 'sigue'));
		await expect(failed).rejects.toThrow('402');
		expect(await next).toBe('sigue');
	});
});
