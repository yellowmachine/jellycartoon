import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { audioFormat, sayableError, transcribe } from '#lib/server/openrouter.ts';
import { familyHasHouse, HouseProblem, sendHouse } from '#lib/server/house.ts';
import { satelliteRequest } from '#lib/server/satellites.ts';

/** An order is a few seconds: more than this is not one. */
const MAX_BYTES = 5_000_000;

/**
 * What a satellite of Seilide's recorded (#296), the house's path (its /api/voice/transcribe):
 * the text that was said, by the house's Whisper if the family has one (it knows its music's
 * names); without it, or if it does not answer, by OpenRouter with the family's key.
 */
export const POST: RequestHandler = async ({ request }) => {
	const { k, satellite } = await satelliteRequest(request);
	const audio = await request.arrayBuffer();
	if (!audio.byteLength) error(400, 'No llegó audio');
	if (audio.byteLength > MAX_BYTES) error(413, 'Demasiado largo');
	const format = audioFormat(request.headers.get('content-type') ?? 'audio/wav');
	if (!format) error(415, 'Ese audio no se puede leer');
	if (await familyHasHouse(k.familyId))
		try {
			const started = performance.now();
			const heard = await sendHouse<{ text: string }>(
				k.familyId,
				'/voz/oir',
				{ method: 'POST', body: audio, type: 'audio/wav' },
				30_000
			);
			console.info(
				`[voz] ${satellite.name}: oído por la casa en ${Math.round(performance.now() - started)} ms`,
				{ familyId: k.familyId }
			);
			return json({ text: heard.text });
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			console.warn(`[voz] ${satellite.name}: sin el Whisper de la casa: ${err.message}`, {
				familyId: k.familyId
			});
		}
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de IA: ponla en Ajustes de Seilide');
	try {
		const started = performance.now();
		const text = await transcribe({ apiKey, audio, format });
		console.info(`[voz] ${satellite.name}: oído en ${Math.round(performance.now() - started)} ms`, {
			familyId: k.familyId
		});
		return json({ text });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] ${satellite.name}: ${message}`, { familyId: k.familyId });
		error(503, sayableError(message));
	}
};
