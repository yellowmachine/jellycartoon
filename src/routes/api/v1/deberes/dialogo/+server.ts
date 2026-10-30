import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readable, titleFor } from '#lib/server/homework-source.ts';
import { cloudPerson } from '#lib/server/media-api.ts';

/** At most, as in Infantil → Deberes. */
const MAX_EPISODES = 3;

/**
 * Homework (#142): the dialogue of the episodes chosen, from their subtitles, for Seilide's AI to
 * ask only about what was said (`{ "capitulos": [12, 13], "idioma": "es" }`); those without any,
 * left out. And the homework's title.
 */
export const POST: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	const body = await request.json().catch(() => ({}));
	const asked: unknown[] = Array.isArray(body?.capitulos) ? body.capitulos : [];
	const ids = [...new Set(asked.filter((n): n is number => Number.isInteger(n)))];
	if (!ids.length || ids.length > MAX_EPISODES) error(400, `De 1 a ${MAX_EPISODES} capítulos`);
	const lang = typeof body?.idioma === 'string' ? body.idioma : null;
	const [episodes, title] = await Promise.all([readable(ids, lang), titleFor(ids)]);
	return json({ titulo: title, capitulos: episodes });
};
