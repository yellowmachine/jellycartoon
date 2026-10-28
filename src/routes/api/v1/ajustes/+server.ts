import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { userSettings } from '#lib/server/db/schema.ts';
import { cloudPerson } from '#lib/server/media-api.ts';
import { normalizeLang } from 'comun/languages.ts';

/**
 * The video API (#253): this person's choices in the player, changed from the cloud's: the audio
 * and subtitles' languages and what follows (`{ audioLang?, subtitleLang?, autoNext? }`), the same
 * as at home. Their subtitles' style is the cloud's own.
 */
export const PATCH: RequestHandler = async ({ request }) => {
	const person = await cloudPerson(request);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') error(400, 'Bad request');
	const values: { audioLang?: string | null; subtitleLang?: string | null; autoNext?: boolean } =
		{};
	for (const key of ['audioLang', 'subtitleLang'] as const) {
		if (!(key in body)) continue;
		const value = body[key];
		if (value !== null && typeof value !== 'string') error(400, 'Bad request');
		values[key] = value === null ? null : normalizeLang(value);
	}
	if ('autoNext' in body) {
		if (typeof body.autoNext !== 'boolean') error(400, 'Bad request');
		values.autoNext = body.autoNext;
	}
	if (Object.keys(values).length === 0) error(400, 'Nothing to update');
	await db
		.insert(userSettings)
		.values({ userId: person.id, ...values })
		.onConflictDoUpdate({ target: userSettings.userId, set: values });
	return json(values);
};
