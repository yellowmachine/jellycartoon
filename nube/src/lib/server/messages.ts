import { eq } from 'drizzle-orm';
import { familyPerson, user } from './db/schema.ts';
import { withFamily } from './family.ts';
import { messagesScope } from './messages-scope.ts';
import { notify } from './push.ts';

/**
 * Mensajes (#551) in the app: the delivery service on its database (messages-scope.ts), «hay algo
 * nuevo» live to the family's open pages (the devices then ask for it), and a notice to the phones
 * of whoever is in the conversation. The notice says who, never what: Seilide cannot read it.
 */
export const messages = messagesScope(withFamily);

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

/** The phones of the others in it: «Miguel te ha escrito», and nothing of what. */
export async function noticeOthers(
	userId: string,
	familyId: string,
	conversationId: string,
	to: string[]
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
	await notify(familyId, to, {
		title: `💬 ${name}`,
		body: 'Mensaje nuevo',
		tag: `mensajes-${conversationId}`,
		url: '/mensajes',
		ttl: 24 * 3600
	});
}
