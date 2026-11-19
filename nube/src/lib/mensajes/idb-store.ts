import type { BackupKeys, BackupStore } from './backup.ts';
import type { DeviceKeys, PrivatePackage, StoredMessage } from './messenger.ts';

/**
 * Mensajes (#551): a device's keys, groups and what was said, in its IndexedDB, one database per
 * person (a shared tablet keeps each one's apart). Never sent anywhere: losing it is losing them
 * (until the PIN backup, #551 phase 1).
 */
export function idbStore(userId: string): BackupStore {
	let opened: Promise<IDBDatabase> | null = null;
	const db = () =>
		(opened ??= new Promise((ok, ko) => {
			const r = indexedDB.open(`seilide-mensajes-${userId}`, 1);
			r.onupgradeneeded = () => {
				r.result.createObjectStore('kv');
				r.result.createObjectStore('groups');
				const m = r.result.createObjectStore('messages', { keyPath: ['conversationId', 'key'] });
				m.createIndex('conversation', 'conversationId');
			};
			r.onsuccess = () => {
				// Asked to be deleted (the device taken out): closed, so it can be.
				r.result.onversionchange = () => r.result.close();
				ok(r.result);
			};
			r.onerror = () => ko(r.error);
		}));
	const req = <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest) =>
		db().then(
			(d) =>
				new Promise<T>((ok, ko) => {
					const t = d.transaction(store, mode);
					const r = fn(t.objectStore(store));
					t.oncomplete = () => ok(r.result as T);
					t.onerror = () => ko(t.error);
				})
		);
	const get = <T>(store: string, key: string) =>
		req<T | undefined>(store, 'readonly', (s) => s.get(key));
	const put = (store: string, value: unknown, key?: string) =>
		req<void>(store, 'readwrite', (s) => s.put(value, key)).then(() => {});
	return {
		device: async () => (await get<DeviceKeys>('kv', 'device')) ?? null,
		setDevice: (d) => put('kv', d, 'device'),
		packages: async () => (await get<PrivatePackage[]>('kv', 'packages')) ?? [],
		setPackages: (p) => put('kv', p, 'packages'),
		group: async (id) => (await get<Uint8Array>('groups', id)) ?? null,
		setGroup: (id, s) => put('groups', s, id),
		removeGroup: (id) => req<void>('groups', 'readwrite', (s) => s.delete(id)).then(() => {}),
		cursor: async () => (await get<number>('kv', 'cursor')) ?? 0,
		setCursor: (n) => put('kv', n, 'cursor'),
		addMessage: (m) => put('messages', m),
		backupKeys: async () => (await get<BackupKeys>('kv', 'backup')) ?? null,
		setBackupKeys: (k) =>
			k
				? put('kv', k, 'backup')
				: req<void>('kv', 'readwrite', (s) => s.delete('backup')).then(() => {}),
		allMessages: () => req<StoredMessage[]>('messages', 'readonly', (s) => s.getAll()),
		messages: (id) =>
			req<StoredMessage[]>('messages', 'readonly', (s) => s.index('conversation').getAll(id)).then(
				(all) => all.sort((a, b) => a.at.localeCompare(b.at))
			)
	};
}
