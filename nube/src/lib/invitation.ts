/** How long an invitation's link works, as svelte-thinking's. */
export const INVITATION_DAYS = 7;

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'cancelled';

/** What an invitation is now, from what was kept of it. */
export function invitationStatus(
	i: { usedAt: Date | null; cancelledAt: Date | null; expiresAt: Date },
	now = new Date()
): InvitationStatus {
	if (i.usedAt) return 'accepted';
	if (i.cancelledAt) return 'cancelled';
	return i.expiresAt <= now ? 'expired' : 'pending';
}

export const invitationExpiry = (from = new Date()) =>
	new Date(from.getTime() + INVITATION_DAYS * 24 * 60 * 60 * 1000);

/** An email that looks like one: what the forms ask before inviting or writing it down. */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
