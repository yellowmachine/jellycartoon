import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { messages } from '#lib/server/messages.ts';
import { MessagesProblem } from '#lib/server/messages-scope.ts';
import { readFile } from '#lib/server/storage.ts';

/** Mensajes (#551): a voice note or a photo, encrypted as it was kept, to someone in its conversation. */
export const GET: RequestHandler = async ({ params, url, locals }) => {
	let familyId: string;
	try {
		familyId = await messages.fileFor(
			locals.user!.id,
			url.searchParams.get('conversacion') ?? '',
			params.id
		);
	} catch (err) {
		if (err instanceof MessagesProblem) error(404, err.message);
		throw err;
	}
	const bytes = await readFile(familyId, 'mensajes', params.id);
	if (!bytes) error(404, 'No hay ese archivo');
	return new Response(bytes, {
		headers: {
			'content-type': 'application/octet-stream',
			'cache-control': 'private, max-age=31536000, immutable'
		}
	});
};
