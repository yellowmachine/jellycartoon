import { describe, expect, test } from 'bun:test';
import { createSatelliteTasks, SatelliteSilent } from './satellite-tasks.ts';

/** Plug tasks for the satellites (#396): sent in its notices, answered, or given up. */
describe('satellite tasks', () => {
	test('asked: in its notices, nudged, and answered once', async () => {
		const nudged: string[] = [];
		const tasks = createSatelliteTasks((id) => nudged.push(id));
		const asked = tasks.ask('sat1', { kind: 'buscar' });
		expect(nudged).toEqual(['sat1']);
		const [task] = tasks.pendingFor('sat1');
		expect(task).toMatchObject({ kind: 'buscar' });
		expect(tasks.pendingFor('sat2')).toEqual([]);
		// Not another satellite's answer.
		expect(tasks.answer('sat2', { id: task!.id, found: [] })).toBe(false);
		expect(tasks.answer('sat1', { id: task!.id, found: [] })).toBe(true);
		expect(await asked).toEqual({ id: task!.id, found: [] });
		expect(tasks.pendingFor('sat1')).toEqual([]);
		expect(tasks.answer('sat1', { id: task!.id })).toBe(false);
	});

	test('no answer in time: SatelliteSilent, and the task is gone', async () => {
		const tasks = createSatelliteTasks(() => {});
		const asked = tasks.ask(
			'sat1',
			{ kind: 'configurar', ip: '192.168.1.5', deviceId: 'x', server: 'wss://s/api/enchufe/t' },
			20
		);
		expect(asked).rejects.toBeInstanceOf(SatelliteSilent);
		await new Promise((r) => setTimeout(r, 40));
		expect(tasks.pendingFor('sat1')).toEqual([]);
	});
});
