import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { paperFile } from '#lib/server/papers.ts';

/**
 * A paper's file (#384), read back: only the family's own, as it is found through its family.
 * Nothing of it stays in the browser's cache.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const file = await paperFile(k, Number(params.id));
	if (!file) error(404, 'No se puede abrir este papel ahora');
	const extension = file.type === 'application/pdf' ? 'pdf' : file.type.split('/')[1];
	return new Response(file.bytes, {
		headers: {
			'Content-Type': file.type,
			'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${file.name ?? 'papel'}.${extension}`)}`,
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
