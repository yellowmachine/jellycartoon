import { json } from '@sveltejs/kit';
import { eq, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { familyMember, user } from '#lib/server/db/schema.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/**
 * The family's adults, by email (#315): for its house to end the sessions of whoever is no longer
 * here (nube-members.ts there). As the house and the cloud know each other's people: by email.
 */
export const GET: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	const adults = await k.run((tx) =>
		tx
			.select({ email: user.email })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.where(ne(familyMember.role, 'peque'))
	);
	return json({ adults: adults.map((a) => a.email) });
};
