import { eq } from 'drizzle-orm';
import type { LayoutServerLoad } from './$types';
import { family } from '#lib/server/db/schema.ts';
import { NoFamily, withFamily } from '#lib/server/family.ts';

/** Who is in, and their family: null if their account is in none. */
export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) return { user: null, family: null };
	const user = { name: locals.user.name, email: locals.user.email };
	try {
		const found = await withFamily(locals.user.id, async (tx, m) => {
			const [f] = await tx
				.select({ name: family.name })
				.from(family)
				.where(eq(family.id, m.familyId));
			return { name: f.name, admin: m.role === 'admin' };
		});
		return { user, family: found };
	} catch (error) {
		if (error instanceof NoFamily) return { user, family: null };
		throw error;
	}
};
