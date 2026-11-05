import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { hearAudio, HearProblem } from '#lib/server/voice/hear.ts';

/** An order is a few seconds: more than this is not one. */
const MAX_BYTES = 5_000_000;

/** What the microphone recorded (#253): the text that was said (hear.ts). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const audio = await request.arrayBuffer();
	if (!audio.byteLength) error(400, 'No llegó audio');
	if (audio.byteLength > MAX_BYTES) error(413, 'Demasiado largo');
	const type = request.headers.get('content-type') ?? 'audio/webm';
	const who = { id: locals.user!.id, email: locals.user!.email };
	try {
		return json({ text: await hearAudio(await kitchenOf(who.id), who, audio, type) });
	} catch (err) {
		if (err instanceof HearProblem) error(err.status, err.message);
		throw err;
	}
};
