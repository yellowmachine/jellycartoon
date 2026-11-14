import { json } from '@sveltejs/kit';
import { sectionOfPath } from '#lib/nav.ts';
import { visits } from '#lib/server/section-visits.ts';
import type { RequestHandler } from './$types';

/**
 * The page, after each navigation: which section it went to (/admin, «Qué usa»). Only a path of a
 * section is kept, by its section; anything else, nothing.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
	const path = typeof body?.path === 'string' ? body.path.slice(0, 200) : '';
	const section = sectionOfPath(path);
	if (section && locals.user) await visits.record(locals.user.id, section.path);
	return json({ ok: true });
};
