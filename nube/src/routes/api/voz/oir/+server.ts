import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { askHouse, HouseProblem } from '#lib/server/house.ts';

/** An order is a few seconds: more than this is not one. */
const MAX_BYTES = 5_000_000;

/**
 * What the road mode's microphone recorded (#253): the text that was said, by the house's Whisper
 * (its /api/v1/voz/oir), which knows its music's names. Without the house, said so.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const audio = await request.arrayBuffer();
	if (!audio.byteLength) error(400, 'No llegó audio');
	if (audio.byteLength > MAX_BYTES) error(413, 'Demasiado largo');
	try {
		return json(
			await askHouse<{ text: string }>(
				locals.user!.id,
				locals.user!.email,
				'/voz/oir',
				{
					method: 'POST',
					body: audio,
					headers: { 'content-type': request.headers.get('content-type') ?? 'audio/webm' }
				},
				30_000
			)
		);
	} catch (err) {
		if (err instanceof HouseProblem) error(503, `Para la voz hace falta la casa: ${err.message}`);
		throw err;
	}
};
