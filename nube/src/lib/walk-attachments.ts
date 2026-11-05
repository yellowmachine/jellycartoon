/**
 * Photos and notes on their way to the server (#416), in the browser's IndexedDB: a walk can go
 * without coverage, and a photo is too big for localStorage. One goes once its walk is at the
 * server; each has its own id, so one sent twice (the answer got lost) is kept once.
 */

export interface Attachment {
	id: string;
	userId: string;
	kind: 'foto' | 'nota';
	blob: Blob;
	at: number;
	position: [number, number] | null;
	/** When the walk it belongs to started; null, a note recorded anywhere else. */
	walk: number | null;
}

const STORE = 'adjuntos';
const URLS = { foto: '/paseos/fotos', nota: '/notas/subir' };

function database() {
	return new Promise<IDBDatabase>((resolve, reject) => {
		const open = indexedDB.open('seilide-paseos', 1);
		open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
		open.onsuccess = () => resolve(open.result);
		open.onerror = () => reject(open.error);
	});
}

async function inStore<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>
) {
	const db = await database();
	try {
		return await new Promise<T>((resolve, reject) => {
			const done = db.transaction(STORE, mode);
			const request = work(done.objectStore(STORE));
			done.oncomplete = () => resolve(request.result);
			done.onerror = done.onabort = () => reject(done.error);
		});
	} finally {
		db.close();
	}
}

/** Kept on the device; throws if it cannot be (no room, a private window). */
export const keepAttachment = (a: Omit<Attachment, 'id'>) =>
	inStore('readwrite', (s) => s.put({ ...a, id: crypto.randomUUID() }));

export async function attachmentsOf(userId: string) {
	const all = await inStore<Attachment[]>('readonly', (s) => s.getAll());
	return all.filter((a) => a.userId === userId);
}

const drop = (id: string) => inStore('readwrite', (s) => s.delete(id));

/** A walk thrown away: what was taken on it too. */
export async function dropWalkAttachments(userId: string, walk: number) {
	for (const a of await attachmentsOf(userId)) if (a.walk === walk) await drop(a.id);
}

/**
 * What is waiting, to the server, but what belongs to `holding` (a walk not there yet). Stops at the
 * first it cannot send, to try again later; its walk gone (404), a photo is let go. How many sent.
 */
export async function sendAttachments(userId: string, holding: number | null = null) {
	let sent = 0;
	for (const a of await attachmentsOf(userId)) {
		if (a.walk !== null && a.walk === holding) continue;
		const form = new FormData();
		form.set('id', a.id);
		form.set('at', String(a.at));
		if (a.position) {
			form.set('lon', String(a.position[0]));
			form.set('lat', String(a.position[1]));
		}
		if (a.walk !== null) form.set('paseo', String(a.walk));
		form.set('fichero', a.blob, a.kind);
		const res = await fetch(URLS[a.kind], { method: 'POST', body: form }).catch(() => null);
		if (res?.ok || res?.status === 404 || res?.status === 415 || res?.status === 413) {
			await drop(a.id);
			if (res.ok) sent++;
		} else return sent;
	}
	return sent;
}
