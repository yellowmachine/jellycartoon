import { eq } from 'drizzle-orm';
import { familyPerson, user } from './db/schema.ts';
import { withFamily } from './family.ts';
import { messagesScope, type PartnerOf } from './messages-scope.ts';
import { calls } from './calls.ts';
import { familyLinks } from './family-links.ts';
import { messagesBackupScope } from './messages-backup-scope.ts';
import { openFor, sealFor } from './family-secret.ts';
import { notify } from './push.ts';

/**
 * Mensajes (#551) in the app: the delivery service on its database (messages-scope.ts), «hay algo
 * nuevo» live to the family's open pages (the devices then ask for it), and a notice to the phones
 * of whoever is in the conversation. The notice says who, never what: Seilide cannot read it.
 */
/** Whom one may write to: as whom one may call (#330), their family or a linked one's adult. */
const partnerOf: PartnerOf = async (userId, otherId) => {
	const person = (await calls.callable(userId)).find((p) => p.userId === otherId);
	if (!person) return null;
	if (!person.family) return { familyId: await withFamily(userId, async (_, m) => m.familyId) };
	const linked = await familyLinks.linkedFamilyOf(userId, otherId);
	return linked ? { familyId: linked.familyId } : null;
};

export const messages = messagesScope(withFamily, partnerOf);

/** Each person's backup behind their PIN: its OPRF key sealed with the family's (and the KMS). */
export const backups = messagesBackupScope(withFamily, { seal: sealFor, open: openFor });

const listeners = new Map<string, Set<() => void>>();

/** Something new in the family's queue: its open pages ask for what is theirs. */
export function tellNew(familyId: string) {
	for (const l of listeners.get(familyId) ?? []) l();
}

export function watchNew(familyId: string, listener: () => void) {
	let set = listeners.get(familyId);
	if (!set) listeners.set(familyId, (set = new Set()));
	set.add(listener);
	return () => {
		set!.delete(listener);
		if (!set!.size) listeners.delete(familyId);
	};
}

/** The phones of the others in it, each in their family: «Miguel te ha escrito», and nothing of what. */
export async function noticeOthers(
	userId: string,
	conversationId: string,
	to: { userId: string; familyId: string }[]
) {
	if (!to.length) return;
	const name = await withFamily(userId, async (tx) => {
		const [row] = await tx
			.select({ person: familyPerson.name, account: user.name })
			.from(user)
			.leftJoin(familyPerson, eq(familyPerson.userId, user.id))
			.where(eq(user.id, userId));
		return row?.person ?? row?.account ?? 'Alguien';
	});
	const families = new Map<string, string[]>();
	for (const t of to) families.set(t.familyId, [...(families.get(t.familyId) ?? []), t.userId]);
	for (const [familyId, userIds] of families)
		await notify(familyId, userIds, {
			title: `💬 ${name}`,
			body: conversationId.startsWith('pareja-') ? 'Te ha escrito' : 'Ha escrito a la familia',
			tag: `mensajes-${conversationId}`,
			url: '/mensajes',
			ttl: 24 * 3600,
			mensajes: { conversationId }
		});
}
