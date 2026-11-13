import { openRouterKey } from '#lib/server/family-settings.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { askHouse, hasHouse, HouseProblem } from '#lib/server/house.ts';
import { audioFormat, sayableError, transcribe } from '#lib/server/openrouter.ts';
import { familyWords, heardPath } from '#lib/server/voice/heard-words.ts';
import { hearsByHouse } from '#lib/server/voice/settings.ts';

/** Why what was said could not be heard, to say so. */
export class HearProblem extends Error {
	constructor(
		message: string,
		readonly status: 415 | 503
	) {
		super(message);
	}
}

/**
 * What was said in a recording: by the house's Whisper (its /api/v1/voz/oir), which knows its
 * music's names, told the family's (heard-words.ts); without the house, or if it does not answer,
 * by OpenRouter with the family's key; always by OpenRouter if the family chose so (Ajustes, «Quién
 * oye lo que se dice»). Throws a HearProblem.
 */
export async function hearAudio(
	k: Kitchen,
	who: { id: string; email: string },
	audio: ArrayBuffer,
	type: string,
	timeoutMs = 30_000
) {
	let houseDown: string | null = null;
	if ((await hasHouse(who.id)) && (await hearsByHouse(k)))
		try {
			const { text } = await askHouse<{ text: string }>(
				who.id,
				who.email,
				heardPath(await familyWords(k)),
				{ method: 'POST', body: audio, headers: { 'content-type': type } },
				timeoutMs
			);
			return text;
		} catch (err) {
			if (!(err instanceof HouseProblem)) throw err;
			houseDown = err.message;
		}
	const apiKey = await openRouterKey(k);
	if (!apiKey)
		throw new HearProblem(
			houseDown
				? `La casa no contesta (${houseDown}) y la familia no tiene clave de IA para oírte sin ella`
				: 'Para hablar hace falta la clave de inteligencia artificial de la familia: Ajustes de Seilide, en «IA»',
			503
		);
	const format = audioFormat(type);
	if (!format) throw new HearProblem(`Ese audio no se puede oír (${type})`, 415);
	try {
		return await transcribe({ apiKey, audio, format, timeoutMs });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[voz] No se pudo oír: ${message}`, { type, bytes: audio.byteLength });
		throw new HearProblem(sayableError(message), 503);
	}
}
