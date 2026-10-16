import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { APP_VERSION } from '$app/env/private';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';

/**
 * For the image's HEALTHCHECK, which WUD waits on after an update to keep it or go back (#20): the
 * app answers and reaches its database. Public, and says nothing but that and the version.
 */
export const GET: RequestHandler = async () => {
	try {
		await db.execute(sql`select 1`);
	} catch {
		return json({ ok: false, version: APP_VERSION }, { status: 503 });
	}
	return json({ ok: true, version: APP_VERSION });
};
