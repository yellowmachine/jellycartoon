import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { userSettings } from '#lib/server/db/schema.ts';
import { normalizeLang } from '#lib/languages.ts';

/** Partial update: `{ audioLang?: string | null, subtitleLang?: string | null }`. */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const body = await request.json();
	const values: { audioLang?: string | null; subtitleLang?: string | null } = {};
	for (const key of ['audioLang', 'subtitleLang'] as const) {
		if (!(key in body)) continue;
		const value = body[key];
		if (value !== null && typeof value !== 'string') error(400, 'Bad request');
		values[key] = value === null ? null : normalizeLang(value);
	}

	if (Object.keys(values).length === 0) error(400, 'Nothing to update');
	await db
		.insert(userSettings)
		.values({ userId: locals.user!.id, ...values })
		.onConflictDoUpdate({ target: userSettings.userId, set: values });
	return json(values);
};
