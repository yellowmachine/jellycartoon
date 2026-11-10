import type { PageServerLoad } from './$types';
import { calls } from '#lib/server/calls.ts';

/** Their calls (#330): who of the family to call, and the history, the newest first. */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [people, history] = await Promise.all([calls.callable(userId), calls.history(userId)]);
	return { people, history };
};
