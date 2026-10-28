import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { deletePreset } from '#lib/server/music/dj-presets.ts';

/** The music API (#253): one of this person's Modo DJ setups, out. */
export const DELETE: RequestHandler = async ({ request, params }) => {
	const person = await cloudPerson(request);
	const id = Number(params.id);
	if (Number.isInteger(id)) await deletePreset(person.id, id);
	return json({ ok: true });
};
