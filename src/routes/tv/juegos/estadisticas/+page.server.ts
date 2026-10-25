import type { PageServerLoad } from './$types';
import { playStats } from '#lib/server/game-sessions.ts';

/** The person's play statistics (#176), in the TV view. */
export const load: PageServerLoad = async ({ locals }) => ({
	stats: await playStats(locals.user!.id)
});
