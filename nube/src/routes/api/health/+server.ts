import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';

/** For Docker's healthcheck and Dokploy: up, and reaching its database. */
export const GET: RequestHandler = async () => {
	await db.execute(sql`select 1`);
	return new Response('ok');
};
