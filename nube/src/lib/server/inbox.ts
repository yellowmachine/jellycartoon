import { eq, inArray } from 'drizzle-orm';
import { familyMember, user } from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import { houseKitchen, type Kitchen } from '#lib/server/fridge.ts';
import { sendInboxMail } from '#lib/server/emails.ts';
import { notify } from '#lib/server/push.ts';
import { keepInInbox, type InboxLevel, type Notice } from '#lib/server/inbox-store.ts';

/**
 * Each person's «Buzón» (#331, phase 1): what the app tells them stays here after the phone's
 * notice is gone, and the messages left for them («déjale un recado a Ana: …», by voice or here).
 * Later, what the rules decide to say. Each one's only theirs, as their memory (memory.ts).
 *
 * `tell` puts it in their inboxes (inbox-store.ts) and on their phones (push.ts); a message, by
 * email too if they chose it (Ajustes → «Cómo te aviso»); an urgent one, by every way, whatever
 * they chose.
 */

export const MAX_MESSAGE = 500;

/**
 * To these people of the family: in their inboxes, on their phones and, as they chose, by email.
 * Never fails, as `notify`: what does not arrive is said in the log.
 */
export async function tell(familyId: string, userIds: string[], notice: Notice) {
	const to = [...new Set(userIds)];
	if (!to.length) return;
	const level = notice.level ?? 'normal';
	try {
		await keepInInbox(houseKitchen(familyId), to, notice);
	} catch (error) {
		console.error('[buzón] No se pudo guardar', { kind: notice.kind, error });
	}
	await notify(familyId, to, { ...notice, sticky: notice.sticky || level === 'urgente' });
	if (notice.kind === 'recado' || level === 'urgente') await mail(familyId, to, notice, level);
}

/** By email, to those who chose it (urgent: to all); not to children (their address is none). */
async function mail(familyId: string, userIds: string[], notice: Notice, level: InboxLevel) {
	try {
		const people = await asFamily(familyId, (tx) =>
			tx
				.select({ email: user.email, byEmail: familyMember.inboxByEmail, role: familyMember.role })
				.from(familyMember)
				.innerJoin(user, eq(user.id, familyMember.userId))
				.where(inArray(familyMember.userId, userIds))
		);
		await Promise.all(
			people
				.filter((p) => p.role !== 'peque' && (p.byEmail || level === 'urgente'))
				.map((p) => sendInboxMail(p.email, notice.title, notice.body, notice.url))
		);
	} catch (error) {
		console.warn('[buzón] No se pudo mandar por correo', { kind: notice.kind, error });
	}
}

/**
 * «Déjale un recado a Ana: que baje a cenar»: to these people of the family, from someone, or from a
 * place (a satellite, no one known). The text kept; null if empty.
 */
export async function leaveMessage(
	k: Kitchen,
	from: { userId: string | null; name: string; place?: boolean },
	userIds: string[],
	text: string
) {
	const clean = text.trim().slice(0, MAX_MESSAGE);
	if (!clean || !userIds.length) return null;
	await tell(k.familyId, userIds, {
		kind: 'recado',
		title: `📨 Recado ${from.place ? 'desde' : 'de'} ${from.name}`,
		body: clean,
		// Each its own: a second one does not take the first one's place.
		tag: `recado-${crypto.randomUUID()}`,
		url: '/buzon',
		ttl: 24 * 3600,
		fromUserId: from.userId
	});
	return clean;
}
