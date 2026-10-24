import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { stoppedLately, watchingNow } from '#lib/server/live-watching.ts';
import { togetherNow } from '#lib/server/watching-together.ts';

/**
 * What the children are watching right now, for /infantil's «Ahora», which asks every few seconds;
 * and whose video stopped lately for nobody answering «¿Sigues ahí?»; and who watches with whom
 * (#160).
 * Adults only: a child's account never gets here, as with the rest of /infantil (see kids.ts).
 */
export const GET: RequestHandler = async () => {
	const kids = (await db.select({ id: user.id }).from(user).where(eq(user.role, KIDS_ROLE))).map(
		(k) => k.id
	);
	const watching = await watchingNow(kids);
	return json({ watching, stopped: stoppedLately(kids), together: await togetherNow(watching) });
};
