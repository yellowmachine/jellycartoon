import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { addRecordedNote, NotAudio } from '#lib/server/notes.ts';
import { MAX_NOTE_BYTES } from '#lib/notes.ts';
import { sentAttachment } from '#lib/server/walks/attachment.ts';

/** A recorded note (#416), from the device that kept it: saved, then heard. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const sent = await sentAttachment(request, MAX_NOTE_BYTES);
	if ('problem' in sent) {
		console.warn('[notas] Nota rechazada', sent.status);
		error(sent.status, sent.problem);
	}
	const who = { id: locals.user!.id, email: locals.user!.email };
	try {
		const { startedAt: walkStarted, ...note } = sent;
		await addRecordedNote(await kitchenOf(who.id), who, { ...note, walkStarted });
	} catch (err) {
		if (err instanceof NotAudio) {
			console.warn('[notas] Nota rechazada', 415);
			error(415, err.message);
		}
		throw err;
	}
	return json({ kept: true });
};
