import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { messages } from '#lib/server/messages.ts';
import { MAX_FILE_BYTES, MessagesProblem } from '#lib/server/messages-scope.ts';
import { putFile } from '#lib/server/storage.ts';

/**
 * Mensajes (#551): a voice note or a photo (#555), already encrypted by the device (its key goes inside the message),
 * kept in the family's storage. Seilide cannot open it.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	const userId = locals.user!.id;
	const bytes = new Uint8Array(await request.arrayBuffer());
	if (bytes.length > MAX_FILE_BYTES) error(413, 'Archivo demasiado grande');
	let file: { id: string; familyId: string };
	try {
		file = await messages.addFile(
			userId,
			url.searchParams.get('aparato') ?? '',
			url.searchParams.get('conversacion') ?? '',
			bytes.length
		);
	} catch (err) {
		if (err instanceof MessagesProblem) error(400, err.message);
		throw err;
	}
	try {
		await putFile(file.familyId, 'mensajes', file.id, bytes, 'application/octet-stream');
	} catch (err) {
		await messages.dropFile(userId, file.id);
		throw err;
	}
	return json({ id: file.id });
};
