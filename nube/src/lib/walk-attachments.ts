/**
 * Photos and notes on their way to the server (#416), in the browser's IndexedDB: a walk can go
 * without coverage, and a photo is too big for localStorage. One goes once its walk is at the
 * server; each has its own id, so one sent twice (the answer got lost) is kept once. Only what the
 * server has is deleted here, or what someone chooses to throw away.
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
	/** Why the server refused it; kept here until someone decides. */
	rejected?: string | null;
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

/** Why the server will not have one, by what it answered: it stays here until it is decided. */
const REJECTED: Record<number, string> = {
	400: 'el servidor no lo entiende',
	404: 'su paseo ya no está',
	413: 'es demasiado grande',
	415: 'no es un formato admitido'
};

/** A rejected one, back in the queue. */
export async function retryAttachment(id: string) {
	const a = await inStore<Attachment | undefined>('readonly', (s) => s.get(id));
	if (a) await inStore('readwrite', (s) => s.put({ ...a, rejected: null }));
}

export const discardAttachment = drop;

/** How long one may take, the server hearing a note included: then it is tried another time. */
const SEND_AT_MOST_MS = 180_000;

export interface SendResult {
	sent: number;
	/** Why some are still waiting; null, nothing went wrong. */
	problem: string | null;
}

/**
 * What is waiting, oldest first, to the server, but what belongs to `holding` (a walk not there
 * yet). One the server refuses stays here, marked with why, and one it fails on is left for later:
 * neither holds up the rest. Without connection or session, nothing else can go: it stops there.
 */
export async function sendAttachments(
	userId: string,
	holding: number | null = null,
	onProgress: (done: number, total: number) => void = () => {}
): Promise<SendResult> {
	const queue = (await attachmentsOf(userId))
		.filter((a) => !a.rejected && !(a.walk !== null && a.walk === holding))
		.sort((x, y) => x.at - y.at);
	let sent = 0;
	let problem: string | null = null;
	for (const [i, a] of queue.entries()) {
		onProgress(i, queue.length);
		const form = new FormData();
		form.set('id', a.id);
		form.set('at', String(a.at));
		if (a.position) {
			form.set('lon', String(a.position[0]));
			form.set('lat', String(a.position[1]));
		}
		if (a.walk !== null) form.set('paseo', String(a.walk));
		form.set('fichero', a.blob, a.kind);
		const res = await fetch(URLS[a.kind], {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(SEND_AT_MOST_MS)
		}).catch(() => null);
		if (!res) return { sent, problem: 'Sin conexión' };
		if (res.status === 401 || res.redirected) return { sent, problem: 'Hay que volver a entrar' };
		if (res.ok) {
			await drop(a.id);
			sent++;
			onProgress(i + 1, queue.length);
		} else if (REJECTED[res.status])
			await inStore('readwrite', (s) => s.put({ ...a, rejected: REJECTED[res.status] }));
		else problem = 'El servidor ha fallado';
	}
	return { sent, problem };
}
