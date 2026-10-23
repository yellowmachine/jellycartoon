import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	cancelAllQueued,
	cancelJob,
	dismissJob,
	labelQueue,
	moveJobFirst,
	retryFailed
} from '#lib/server/episode-labels.ts';

/** Gestión → Etiquetado: the episodes Ollama's vision model labels, all of them in one place. */
export const load: PageServerLoad = async () => ({ queue: await labelQueue() });

/** One that takes a job, or says it is not one. */
const onJob =
	(act: (id: number) => Promise<void>) =>
	async ({ request }: { request: Request }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { message: 'Trabajo no válido' });
		await act(id);
	};

export const actions: Actions = {
	cancelAll: async () => cancelAllQueued(),
	retryAll: async () => retryFailed(),
	cancel: onJob(cancelJob),
	first: onJob(moveJobFirst),
	retry: onJob(retryFailed),
	dismiss: onJob(dismissJob)
};
