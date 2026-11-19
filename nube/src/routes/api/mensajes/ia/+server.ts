import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { askForMessage, ChatError } from '#lib/server/chat.ts';
import { kitchenOf } from '#lib/server/fridge.ts';

/**
 * Mensajes (#555): what the person asks the AI in its panel, to send: cards (a recipe, a list).
 * Only what is written there comes here, never the conversation (encrypted, in the devices); and
 * nothing is kept: the panel sends its earlier turns. Children have no Mensajes (kids.ts).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body.question !== 'string') error(400, 'Falta lo que pides');
	try {
		return json(
			await askForMessage(
				await kitchenOf(locals.user!.id),
				{ id: locals.user!.id, name: locals.user!.name },
				{
					question: body.question,
					to: typeof body.to === 'string' ? body.to : '',
					assistant: typeof body.assistant === 'string' ? body.assistant : '',
					turns: Array.isArray(body.turns) ? body.turns : []
				}
			)
		);
	} catch (err) {
		if (err instanceof ChatError) error(503, err.message);
		throw err;
	}
};
