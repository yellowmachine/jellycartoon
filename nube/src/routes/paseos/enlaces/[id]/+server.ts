import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { revokeShare } from '#lib/server/walks/share.ts';

/** «Retirar» a link (#434): only one's own. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Enlace no encontrado');
	await revokeShare(await kitchenOf(locals.user!.id), id);
	return new Response(null, { status: 204 });
};
