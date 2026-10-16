import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { videoClosed } from '#lib/server/kid-time.ts';

/** Where a child's video goes out of its time (#18); once it is time again, home. */
export const load: PageServerLoad = async ({ locals }) => {
	const closed = await videoClosed(locals.user!.id);
	if (!closed) redirect(303, '/');
	return { closed };
};
