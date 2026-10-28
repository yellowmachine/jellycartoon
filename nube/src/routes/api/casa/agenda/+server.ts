import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addEventByVoice, agendaByVoice } from '#lib/server/agenda/voice.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/**
 * The family's agenda, for its house's voice (jellycartoon's add_event and agenda): something
 * written down (`add`), or what there is some days (`read`; a child, `kid` with their name, only
 * theirs). The AI's arguments as it gave them; back, what to tell it.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const body = await request.json().catch(() => null);
	const args = body?.args;
	if (!args || typeof args !== 'object') error(400, 'Petición no válida');
	switch (body.action) {
		case 'add':
			return json({ say: await addEventByVoice(k, args) });
		case 'read':
			return json({
				say: await agendaByVoice(k, args, typeof body.kid === 'string' ? body.kid : null)
			});
		default:
			error(400, 'Petición no válida');
	}
};
