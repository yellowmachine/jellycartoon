import { Messenger, describe } from '#lib/mensajes/messenger.ts';
import { idbStore } from '#lib/mensajes/idb-store.ts';
import { httpTransport } from '#lib/mensajes/http-transport.ts';
import { lockFor } from '#lib/mensajes/lock.ts';

/**
 * Mensajes (#551): what a message says, for its notice, decrypted here in the phone. The push says
 * only which conversation; the worker syncs as the page would (same groups, same lock, what it
 * reads kept for the page) and takes the last one of someone else. Null: nothing to say (no device
 * here, not in it, too slow): the notice as the server sent it.
 */
const PREFIX = 'seilide-mensajes-';
const WAIT_MS = 8000;

export async function decryptedText(conversationId: string): Promise<string | null> {
	const read = async () => {
		const dbs = (await indexedDB.databases?.()) ?? [];
		for (const { name } of dbs) {
			if (!name?.startsWith(PREFIX)) continue;
			const userId = name.slice(PREFIX.length);
			const store = idbStore(userId);
			if (!(await store.device())) continue;
			const m = new Messenger(store, httpTransport, userId, undefined, lockFor(userId));
			await m.sync();
			const last = (await m.messages(conversationId)).filter((x) => !x.mine).at(-1);
			if (last) return describe(last);
		}
		return null;
	};
	return Promise.race([
		read().catch(() => null),
		new Promise<null>((r) => setTimeout(() => r(null), WAIT_MS))
	]);
}
