import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudPerson } from '#lib/server/media-api.ts';
import { savePreset } from '#lib/server/music/dj-presets.ts';
import { parseDjOptions } from 'comun/music.ts';

/** A saved setup's name: short enough for the menu. */
const PRESET_NAME_MAX = 60;

/**
 * The music API (#253): a Modo DJ setup of this person's, saved with a name from the cloud: new,
 * or `id` changed. Its id back; 409 if they already have another one with that name.
 */
export const POST: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	const body = await request.json().catch(() => null);
	const name = String(body?.name ?? '').trim();
	if (!name || name.length > PRESET_NAME_MAX)
		error(400, `Ponle un nombre (hasta ${PRESET_NAME_MAX} letras)`);
	const options = parseDjOptions(body?.options);
	if (!options) error(400, 'Configuración no válida');
	const id = Number.isInteger(body?.id) ? (body.id as number) : null;
	const saved = await savePreset(person.id, id, name, options);
	if (saved === null) error(409, `Ya tienes una que se llama «${name}»`);
	return json({ id: saved });
};
