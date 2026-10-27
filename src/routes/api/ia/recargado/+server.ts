import { error } from '@sveltejs/kit';
import { isAdmin } from '#lib/server/app-settings.ts';
import { isKid } from '#lib/server/kids.ts';
import { creditRecharged } from '#lib/server/openrouter.ts';
import type { RequestHandler } from './$types';

/** The banner's «Ya he recargado»: the AI's requests go out again (openrouter.ts). */
export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || isKid(locals.user) || !(await isAdmin(locals.user.id)))
		error(404, 'No encontrado');
	creditRecharged();
	return new Response(null, { status: 204 });
};
