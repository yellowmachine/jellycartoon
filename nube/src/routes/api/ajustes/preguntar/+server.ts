import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openRouterKey } from '#lib/server/family-settings.ts';
import { withFamily } from '#lib/server/family.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { sayableError } from '#lib/server/openrouter.ts';
import { askSettings, MAX_QUESTION } from '#lib/server/settings-ask.ts';
import { SETTINGS_INDEX } from '#lib/settings-index.ts';

/**
 * «Preguntar a la IA» in Ajustes (settings-ask.ts): the sections that do what was asked, among
 * those this person sees, as the page shows them.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const question = typeof body?.question === 'string' ? body.question.trim() : '';
	if (!question) error(400, 'Falta qué buscas');
	if (question.length > MAX_QUESTION) error(413, 'Demasiado largo: dilo más corto');
	const k = await kitchenOf(locals.user!.id);
	const [admin, apiKey] = await Promise.all([
		withFamily(locals.user!.id, async (_, m) => m.role === 'admin'),
		openRouterKey(k)
	]);
	if (!apiKey) error(503, 'La familia no tiene clave de inteligencia artificial');
	const shown = { admin, spendLine: true };
	const entries = SETTINGS_INDEX.filter((e) => e.shown?.(shown) ?? true);
	try {
		return json(await askSettings(apiKey, question, entries, admin));
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`[ajustes] «${question}»: ${message}`);
		error(503, sayableError(message));
	}
};
