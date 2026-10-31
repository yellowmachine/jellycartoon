import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { askHouse, hasHouse, HouseProblem } from '#lib/server/house.ts';
import { audioFormat, sayableError, transcribe } from '#lib/server/openrouter.ts';
import { familyWords, heardPath } from '#lib/server/voice/heard-words.ts';

/** An order is a few seconds: more than this is not one. */
const MAX_BYTES = 5_000_000;

/**
 * What the microphone recorded (#253): the text that was said, by the house's Whisper (its
 * /api/v1/voz/oir), which knows its music's names, told the family's (heard-words.ts); without
 * the house, or if it does not answer, by OpenRouter with the family's key.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const audio = await request.arrayBuffer();
	if (!audio.byteLength) error(400, 'No llegó audio');
	if (audio.byteLength > MAX_BYTES) error(413, 'Demasiado largo');
	const type = request.headers.get('content-type') ?? 'audio/webm';
	let houseDown: string | null = null;
	if (await hasHouse(locals.user!.id))
		try {
			return json(
				await askHouse<{ text: string }>(
					locals.user!.id,
					locals.user!.email,
					heardPath(await familyWords(await kitchenOf(locals.user!.id))),
					{ method: 'POST', body: audio, headers: { 'content-type': type } },
					30_000
				)
			);
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			houseDown = err.message;
		}
	const apiKey = await openRouterKey(await kitchenOf(locals.user!.id));
	if (!apiKey)
		error(
			503,
			houseDown
				? `La casa no contesta (${houseDown}) y la familia no tiene clave de IA para oírte sin ella`
				: 'Para hablar hace falta la clave de inteligencia artificial de la familia: Ajustes de Seilide, en «IA»'
		);
	const format = audioFormat(type);
	if (!format) error(415, `Ese audio no se puede oír (${type})`);
	try {
		return json({ text: await transcribe({ apiKey, audio, format }) });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] No se pudo oír: ${message}`, { type, bytes: audio.byteLength });
		error(503, sayableError(message));
	}
};
