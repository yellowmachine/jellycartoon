import { randomUUID } from 'node:crypto';
import type { PlugTask, PlugTaskResult } from 'comun/voice.ts';

/**
 * Plug tasks for the satellites (#396): finding the Shelly in the home's network, or pointing one at
 * Seilide, which only something inside that network can do. Each goes in the satellite's notices
 * (`plugTasks`, /api/satelite/avisos) and waits for its answer (/api/satelite/enchufes), or gives up.
 * In memory, as what the satellites are to say once.
 */

/** A satellite that does not answer in this long is not there, or not up to date. */
export const TASK_MS = 15_000;

/** Without the `id`, which is given here. */
type NewTask = PlugTask extends infer T ? (T extends PlugTask ? Omit<T, 'id'> : never) : never;

export class SatelliteSilent extends Error {
	constructor() {
		super('El satélite no contesta');
	}
}

export function createSatelliteTasks(nudge: (satelliteId: string) => void) {
	const tasks = new Map<string, PlugTask[]>();
	const waiting = new Map<string, (result: PlugTaskResult) => void>();

	function drop(satelliteId: string, taskId: string) {
		const left = (tasks.get(satelliteId) ?? []).filter((t) => t.id !== taskId);
		if (left.length) tasks.set(satelliteId, left);
		else tasks.delete(satelliteId);
		waiting.delete(taskId);
	}

	return {
		/** Asked of that satellite: its answer, or SatelliteSilent. */
		ask(satelliteId: string, task: NewTask, timeoutMs = TASK_MS): Promise<PlugTaskResult> {
			const id = randomUUID();
			const full = { ...task, id } as PlugTask;
			tasks.set(satelliteId, [...(tasks.get(satelliteId) ?? []), full]);
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => {
					drop(satelliteId, id);
					reject(new SatelliteSilent());
				}, timeoutMs);
				waiting.set(id, (result) => {
					clearTimeout(timer);
					drop(satelliteId, id);
					resolve(result);
				});
				nudge(satelliteId);
			});
		},
		/** What it has to do now. */
		pendingFor: (satelliteId: string) => tasks.get(satelliteId) ?? [],
		/** Its answer: only to a task of its own. */
		answer(satelliteId: string, result: PlugTaskResult) {
			if (!(tasks.get(satelliteId) ?? []).some((t) => t.id === result.id)) return false;
			waiting.get(result.id)?.(result);
			return true;
		}
	};
}

export type SatelliteTasks = ReturnType<typeof createSatelliteTasks>;
