import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { calls } from '#lib/server/calls.ts';

/** A call (#330), from its notice: ringing for them, lasting, or over. Only for its two. */
export const load: PageServerLoad = async ({ params, locals, url }) => {
	const info = await calls.info(locals.user!.id, params.id);
	if (!info) error(404, 'No es una llamada tuya');
	return { info, answer: url.searchParams.has('contestar') };
};
