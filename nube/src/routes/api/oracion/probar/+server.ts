import { error, json } from '@sveltejs/kit';
import { isAiVoice, MAX_TONE_CHARS } from 'comun/ai-voice.ts';
import type { RequestHandler } from './$types';
import { MAX_TRY } from '#lib/prayers.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { prayerKitchen } from '#lib/server/prayer-pages.ts';
import { tryVoice } from '#lib/server/prayers.ts';

/**
 * A voice tried (#339): `{ voice, tone, text }`, its few lines read and given back as Ogg Opus, not
 * kept. A child does not get here (kids.ts: only GET). A problem, as `{ message }`.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await prayerKitchen(locals);
	const body = await request.json().catch(() => null);
	const voice = body?.voice;
	const tone = typeof body?.tone === 'string' ? body.tone.trim().slice(0, MAX_TONE_CHARS) : '';
	const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_TRY) : '';
	if (!isAiVoice(voice) || !text) error(400, 'Falta la voz o el texto');
	const apiKey = await openRouterKey(k);
	if (!apiKey)
		return json(
			{ message: 'Falta la clave de OpenRouter de la familia (Ajustes → Familia).' },
			{ status: 400 }
		);
	try {
		const ogg = await tryVoice(k.familyId, apiKey, { voice, tone }, text);
		return new Response(ogg, {
			headers: { 'Content-Type': 'audio/ogg', 'Cache-Control': 'no-store' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ message: sayableError(message) }, { status: 502 });
	}
};
