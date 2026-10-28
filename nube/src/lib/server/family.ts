import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { familyMember, invitation } from './db/schema.ts';
import { familyScope } from './family-scope.ts';

export { NoFamily, type Membership } from './family-scope.ts';

/** A family's rows, for the person asking (family-scope.ts). */
export const withFamily = familyScope(db);

/** The unused invitation for this email, if any: only with one can someone sign up. */
export async function invitationFor(email: string) {
	const [found] = await db
		.select()
		.from(invitation)
		.where(
			and(
				eq(sql`lower(${invitation.email})`, email.trim().toLowerCase()),
				isNull(invitation.usedAt)
			)
		);
	return found ?? null;
}

/**
 * The new account into the family it was invited to, with the invitation's role, and the
 * invitation spent. In that family's context, as row-level security asks (family.schema.ts).
 */
export async function joinInvitedFamily(userId: string, email: string) {
	const invited = await invitationFor(email);
	if (!invited) return;
	await db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.family_id', ${invited.familyId}, true)`);
		await tx
			.insert(familyMember)
			.values({ userId, familyId: invited.familyId, role: invited.role });
		await tx.update(invitation).set({ usedAt: new Date() }).where(eq(invitation.id, invited.id));
	});
}
