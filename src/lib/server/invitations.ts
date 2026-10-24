import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { invitation } from '#lib/server/db/schema.ts';

/**
 * The link an adult enters with the first time (#157), or after forgetting their password: Better
 * Auth's password reset, whose `sendResetPassword` (auth.ts) records it here instead of sending an
 * email, and the administrator is given it (people.ts). Only the newest link of each person works.
 */

/** As long as a link works: Better Auth's `resetPasswordTokenExpiresIn`, in seconds. */
export const INVITATION_SECONDS = 48 * 60 * 60;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** The token just made for each person, until the administrator's request takes it. */
const issued = new Map<string, string>();

/** From `sendResetPassword`: this person's link, replacing the one before. */
export async function recordInvitation(userId: string, token: string) {
	const row = {
		tokenHash: hash(token),
		expiresAt: new Date(Date.now() + INVITATION_SECONDS * 1000),
		usedAt: null,
		createdAt: new Date()
	};
	await db
		.insert(invitation)
		.values({ userId, ...row })
		.onConflictDoUpdate({ target: invitation.userId, set: row });
	issued.set(userId, token);
}

/** The token `recordInvitation` was given for this person, once. */
export function takeIssued(userId: string) {
	const token = issued.get(userId);
	issued.delete(userId);
	return token;
}

/** From `onPasswordReset`: chosen, the link is spent. */
export async function markUsed(userId: string) {
	await db.update(invitation).set({ usedAt: new Date() }).where(eq(invitation.userId, userId));
}

/**
 * What a link is: whose, if it still works; used, if its password was chosen; and otherwise gone
 * (expired, or replaced by a newer one, or never made).
 */
export async function invitationByToken(token: string) {
	const [row] = await db
		.select()
		.from(invitation)
		.where(eq(invitation.tokenHash, hash(token)));
	if (!row) return { state: 'gone' as const };
	if (row.usedAt) return { state: 'used' as const };
	if (row.expiresAt < new Date()) return { state: 'gone' as const };
	return { state: 'valid' as const, userId: row.userId };
}

/** Each person's newest link: when it ends, and whether it was used. */
export async function invitations() {
	return db
		.select({
			userId: invitation.userId,
			expiresAt: invitation.expiresAt,
			usedAt: invitation.usedAt
		})
		.from(invitation);
}
