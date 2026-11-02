import type { PageServerLoad } from './$types';
import { PERMITS } from 'comun/avatars.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { pendingFor } from '#lib/server/kid-login.ts';

/**
 * A child's request to enter (#303), opened from the QR on its device: the same answer as the
 * notice, for an adult who lets it in. None, if it is not theirs to answer or is already over.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const pending = await pendingFor(await kitchenOf(locals.user!.id));
	return { request: pending.find((r) => r.id === params.id) ?? null, permits: PERMITS };
};
