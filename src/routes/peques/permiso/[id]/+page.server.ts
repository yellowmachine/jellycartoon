import type { PageServerLoad } from './$types';
import { PERMITS } from 'comun/avatars.ts';
import { pendingFor } from '#lib/server/kid-login.ts';

/**
 * A child's request to enter (#279, as Seilide's #303), opened from the QR on the TV: the same
 * answer as the notice, for an adult who lets it in, also one whose phone gets no notices from this
 * house. None, if it is not theirs to answer or is already over.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const pending = await pendingFor(locals.user!.id);
	return { request: pending.find((r) => r.id === params.id) ?? null, permits: PERMITS };
};
