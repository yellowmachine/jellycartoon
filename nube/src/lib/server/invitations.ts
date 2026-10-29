import { ADMIN_EMAIL, ORIGIN } from '$app/env/private';
import { db } from './db/index.ts';
import { sendInvitation } from './emails.ts';
import { invitationScope } from './invitation-scope.ts';

/** The app's invitations (invitation-scope.ts), as its own role. */
export const invitations = invitationScope(db);

export const invitationLink = (token: string) => `${ORIGIN}/invitacion/${token}`;

/** The service's administrator, who lets families in (/admin/lista-de-espera): ADMIN_EMAIL. */
export const isServiceAdmin = (email: string | undefined) =>
	Boolean(ADMIN_EMAIL && email && email.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase());

/**
 * Invited, and its link sent by email. If the email does not go, the invitation is kept all the
 * same: `sent` false, and its link is there to pass on by hand.
 */
export async function inviteAndSend(i: {
	email: string;
	familyId: string | null;
	familyName: string | null;
	role: 'admin' | 'member';
	inviter: { id: string; name: string };
}) {
	const made = await invitations.invite({
		email: i.email,
		familyId: i.familyId,
		role: i.role,
		invitedBy: i.inviter.id
	});
	if (!made.ok) return made;
	const link = invitationLink(made.token);
	let sent = true;
	try {
		await sendInvitation({
			to: i.email.trim(),
			link,
			inviterName: i.inviter.name,
			familyName: i.familyName
		});
	} catch (error) {
		console.error(`[invitations] El correo a ${i.email} no salió:`, error);
		sent = false;
	}
	return { ok: true as const, link, sent };
}
