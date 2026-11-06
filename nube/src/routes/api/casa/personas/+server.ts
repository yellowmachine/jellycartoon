import { json } from '@sveltejs/kit';
import { eq, inArray, ne } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { familyMember, familyPerson, kidGuardian, user } from '#lib/server/db/schema.ts';
import { houseRequest } from '#lib/server/house-keys.ts';

/**
 * The family's people, by email, as the house and the cloud know each other's: its adults, for its
 * house to end the sessions of whoever is no longer here (#315); its children, with their drawing
 * and who lets them in, for its «¿Quién eres?» and their rules there (#279, seilide-kids.ts there).
 */
export const GET: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	return json(
		await k.run(async (tx) => {
			const adults = await tx
				.select({ email: user.email })
				.from(familyMember)
				.innerJoin(user, eq(user.id, familyMember.userId))
				.where(ne(familyMember.role, 'peque'));
			const kids = await tx
				.select({
					id: user.id,
					email: user.email,
					name: user.name,
					avatar: familyPerson.avatar
				})
				.from(familyMember)
				.innerJoin(user, eq(user.id, familyMember.userId))
				.leftJoin(familyPerson, eq(familyPerson.userId, familyMember.userId))
				.where(eq(familyMember.role, 'peque'));
			const guardians = kids.length
				? await tx
						.select({ kidId: kidGuardian.kidId, email: user.email })
						.from(kidGuardian)
						.innerJoin(user, eq(user.id, kidGuardian.guardianId))
						.where(
							inArray(
								kidGuardian.kidId,
								kids.map((kid) => kid.id)
							)
						)
				: [];
			return {
				adults: adults.map((a) => a.email),
				kids: kids.map(({ id, ...kid }) => ({
					...kid,
					guardians: guardians.filter((g) => g.kidId === id).map((g) => g.email)
				}))
			};
		})
	);
};
