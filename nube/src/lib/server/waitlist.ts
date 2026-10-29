import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from './db/index.ts';
import { invitation, user, waitlist } from './db/schema.ts';
import { sendWaitlistNotice, sendWaitlistReceived } from './emails.ts';

/**
 * A family asking to come in (the landing page's «Pedir acceso»). Asking again changes nothing and
 * says nothing different, so the form does not tell who has asked or has an account. The emails go
 * after, without holding the answer: the request is kept even if they fail.
 */
export async function askForAccess(request: {
	email: string;
	name: string;
	message: string | null;
}) {
	const [added] = await db
		.insert(waitlist)
		.values({ id: crypto.randomUUID(), ...request })
		.onConflictDoNothing()
		.returning({ id: waitlist.id });
	if (!added) return;
	sendWaitlistReceived(request.email, request.name).catch((error) =>
		console.error(`[waitlist] El correo a ${request.email} no salió:`, error)
	);
	sendWaitlistNotice(request).catch((error) =>
		console.error('[waitlist] El aviso al administrador no salió:', error)
	);
}

/**
 * Who asked, newest first, for the service's administrator: with how their invitation is going
 * (an open one, perhaps lapsed) and whether they already have an account.
 */
export async function waitingList() {
	const rows = await db
		.select({
			id: waitlist.id,
			email: waitlist.email,
			name: waitlist.name,
			message: waitlist.message,
			status: waitlist.status,
			createdAt: waitlist.createdAt,
			invitationExpiresAt: invitation.expiresAt,
			hasAccount: sql<boolean>`exists (select 1 from ${user} where lower(${user.email}) = lower(${waitlist.email}))`
		})
		.from(waitlist)
		.leftJoin(
			invitation,
			and(
				eq(sql`lower(${invitation.email})`, sql`lower(${waitlist.email})`),
				isNull(invitation.familyId),
				isNull(invitation.usedAt),
				isNull(invitation.cancelledAt)
			)
		)
		.orderBy(desc(waitlist.createdAt));
	return rows.map(({ invitationExpiresAt, ...r }) => ({
		...r,
		invitation: invitationExpiresAt
			? invitationExpiresAt > new Date()
				? ('pending' as const)
				: ('expired' as const)
			: null
	}));
}

export async function setWaitlistStatus(id: string, status: 'approved' | 'rejected') {
	const [row] = await db
		.update(waitlist)
		.set({ status })
		.where(eq(waitlist.id, id))
		.returning({ email: waitlist.email, name: waitlist.name });
	return row ?? null;
}

export async function waitlistEntry(id: string) {
	const [row] = await db.select().from(waitlist).where(eq(waitlist.id, id));
	return row ?? null;
}
