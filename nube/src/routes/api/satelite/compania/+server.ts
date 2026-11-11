import { error, json } from '@sveltejs/kit';
import type { CompanionReply } from 'comun/voice.ts';
import type { RequestHandler } from './$types';
import { companionAnswer } from '#lib/server/companion.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';

/**
 * What a satellite heard after a question of «Compañía» (#469), as text (empty: nothing said): an
 * answer or not, judged here, and what to say back (empty: nothing).
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k } = await satelliteRequest(request);
	const { text } = (await request.json().catch(() => ({}))) as { text?: unknown };
	if (typeof text !== 'string') error(400, 'Falta lo oído');
	const reply = await companionAnswer(k, text.slice(0, 2000));
	return json({ reply } satisfies CompanionReply);
};
