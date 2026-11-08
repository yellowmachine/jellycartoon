import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { createShare, walkSharesOf } from '#lib/server/walks/share.ts';

/** A walk's links (#434): only one's own. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Paseo no encontrado');
	return json(await walkSharesOf(await kitchenOf(locals.user!.id), id));
};

/** A new link: its address, shown once (only its hash is kept). */
export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Paseo no encontrado');
	const body = (await request.json().catch(() => null)) as {
		label?: unknown;
		photoIds?: unknown;
		trim?: unknown;
	} | null;
	if (!body) error(400, 'No se entiende lo enviado');
	const photoIds = Array.isArray(body.photoIds)
		? body.photoIds.filter((p): p is number => Number.isInteger(p)).slice(0, 500)
		: [];
	const made = await createShare(await kitchenOf(locals.user!.id), id, {
		label: typeof body.label === 'string' ? body.label : null,
		photoIds,
		trim: body.trim !== false
	});
	if (!made.ok) error(made.status, made.problem);
	return json({ url: `${url.origin}/p/${made.token}` });
};
