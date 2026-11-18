import type { PageServerLoad } from './$types';
import { vistaOf } from '#lib/server/vista.ts';

/** The Vista's home (#525): today in the house, on the tablet on the wall. */
export const load: PageServerLoad = async ({ locals }) => ({
	vista: await vistaOf(locals.user!.id)
});
