import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { houseRequest } from '#lib/server/house-keys.ts';
import {
	deleteTag,
	ensureTags,
	linkSeries,
	releaseTag,
	renameTag,
	tagName,
	unlinkSeries
} from '#lib/server/tags.ts';

const MAX_NAME = 40;
const isId = (value: unknown): value is number => Number.isInteger(value);

function nameOf(value: unknown) {
	const name = typeof value === 'string' ? tagName(value) : '';
	if (!name || name.length > MAX_NAME) error(400, 'Etiqueta no válida');
	return name;
}

/** Lo que la casa escribe en sus etiquetas (#394): vuelve a ella por Electric, no por aquí. */
export const POST: RequestHandler = async ({ request }) => {
	const { familyId, run } = await houseRequest(request);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Petición no válida');
	const { action, seriesId, tagId, name, names, usedHere } = body;

	switch (action) {
		case 'ensure': {
			if (!Array.isArray(names) || names.length > 50) error(400, 'Petición no válida');
			const clean = [...new Set(names.map(nameOf))];
			return json({ tags: await run((tx) => ensureTags(tx, familyId, clean)) });
		}
		case 'link':
			if (!isId(seriesId)) error(400, 'Serie no válida');
			return json({ tag: await run((tx) => linkSeries(tx, familyId, seriesId, nameOf(name))) });
		case 'unlink':
			if (!isId(seriesId) || !isId(tagId)) error(400, 'Petición no válida');
			await run((tx) => unlinkSeries(tx, seriesId, tagId, usedHere === true));
			return json({ ok: true });
		case 'release':
			if (!isId(tagId)) error(400, 'Etiqueta no válida');
			await run((tx) => releaseTag(tx, tagId, usedHere === true));
			return json({ ok: true });
		case 'rename':
			if (!isId(tagId)) error(400, 'Etiqueta no válida');
			return json(await run((tx) => renameTag(tx, familyId, tagId, nameOf(name))));
		case 'delete':
			if (!isId(tagId)) error(400, 'Etiqueta no válida');
			await run((tx) => deleteTag(tx, tagId));
			return json({ ok: true });
		default:
			error(400, 'Petición no válida');
	}
};
