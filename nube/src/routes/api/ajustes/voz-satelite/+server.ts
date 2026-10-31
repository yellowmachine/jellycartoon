import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AI_VOICE, DEFAULT_TONE, isSatelliteVoice, MAX_TONE_CHARS } from 'comun/ai-voice.ts';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { satelliteSpeech } from '#lib/server/voice/satellite-voice.ts';

/** A phrase, not a speech. */
const MAX_CHARS = 200;

/**
 * «Probar» in Ajustes → Familia → «Voz de los satélites» (#296): that phrase in that voice and tone,
 * as the satellites would say it, before saving them. Only its administrator, with the family's key.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const admin = await withFamily(locals.user!.id, async (_, m) => m.role === 'admin');
	if (!admin) error(403, 'Solo quien administra la familia');
	const body = await request.json().catch(() => null);
	const text = typeof body?.text === 'string' ? body.text.trim().slice(0, MAX_CHARS) : '';
	if (!text) error(400, 'Falta qué decir');
	const k = await kitchenOf(locals.user!.id);
	const apiKey = await openRouterKey(k);
	if (!apiKey) error(503, 'La familia no tiene clave de inteligencia artificial');
	const voice = {
		voice: isSatelliteVoice(body.voice) ? body.voice : AI_VOICE.voice,
		tone:
			(typeof body.tone === 'string' ? body.tone.trim().slice(0, MAX_TONE_CHARS) : '') ||
			DEFAULT_TONE,
		fillers: []
	};
	try {
		return new Response(await satelliteSpeech(k, apiKey, text, voice), {
			headers: { 'content-type': 'audio/wav' }
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[ajustes] Probar la voz: ${message}`);
		error(503, sayableError(message));
	}
};
