import { Evaluation, Oprf, OPRFClient } from '@cloudflare/voprf-ts';
import { fromB64, toB64, type Store, type StoredMessage } from './messenger.ts';

/**
 * Mensajes (#551): the person's backup of what their devices have read, behind their PIN. From the
 * PIN, blinded, the server's OPRF (messages-backup-scope.ts) gives a result only this device can
 * finish; from it two keys: one encrypts the backup (never leaves the device), the other proves the
 * PIN to the server (it keeps only its hash). The groups' MLS state is not backed up: a new device
 * joins them as any new one, and the backup gives it what was said before.
 */

export const SUITE = Oprf.Suite.P256_SHA256;
/** At least 6 digits (decided in #551): with the server and the KMS stolen, 4 fell in minutes. */
export const PIN = /^\d{6,12}$/;

export interface BackupKeys {
	/** AES-256-GCM's, raw. */
	enc: Uint8Array;
	/** Shown to the server to prove the PIN, base64. */
	proof: string;
}

export interface BackupStatus {
	backup: boolean;
	triesLeft: number;
	updatedAt: string | null;
}

export interface BackupTransport {
	status(): Promise<BackupStatus>;
	evaluate(blinded: string): Promise<string>;
	create(c: { proof: string; blob: string; replace: boolean }): Promise<void>;
	open(proof: string): Promise<{ blob: string }>;
	save(c: { proof: string; blob: string }): Promise<void>;
	forget(): Promise<void>;
}

/** Where a device keeps its backup keys, once the PIN was right: beside its messages. */
export interface BackupStore extends Store {
	backupKeys(): Promise<BackupKeys | null>;
	setBackupKeys(k: BackupKeys | null): Promise<void>;
	allMessages(): Promise<StoredMessage[]>;
}

const te = new TextEncoder();
const td = new TextDecoder();
/** On a buffer of its own, as WebCrypto's types ask. */
const own = (u: Uint8Array) => Uint8Array.from(u);

async function keysFromPin(userId: string, pin: string, t: BackupTransport): Promise<BackupKeys> {
	const client = new OPRFClient(SUITE);
	const [fin, req] = await client.blind([te.encode(`seilide-mensajes:${userId}:${pin}`)]);
	const evaluation = Evaluation.deserialize(
		SUITE,
		fromB64(await t.evaluate(toB64(req.serialize())))
	);
	const [out] = await client.finalize(fin, evaluation);
	const base = await crypto.subtle.importKey('raw', own(out!), 'HKDF', false, ['deriveBits']);
	const derive = async (info: string) =>
		new Uint8Array(
			await crypto.subtle.deriveBits(
				{
					name: 'HKDF',
					hash: 'SHA-256',
					salt: te.encode('seilide-mensajes-copia'),
					info: te.encode(info)
				},
				base,
				256
			)
		);
	return { enc: await derive('cifrar'), proof: toB64(await derive('probar')) };
}

async function seal(enc: Uint8Array, messages: StoredMessage[]) {
	const key = await crypto.subtle.importKey('raw', own(enc), 'AES-GCM', false, ['encrypt']);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const plain = te.encode(JSON.stringify({ v: 1, messages }));
	const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
	const out = new Uint8Array(iv.length + sealed.length);
	out.set(iv);
	out.set(sealed, iv.length);
	return toB64(out);
}

async function unseal(enc: Uint8Array, blob: string): Promise<StoredMessage[]> {
	if (!blob) return [];
	const bytes = fromB64(blob);
	const key = await crypto.subtle.importKey('raw', own(enc), 'AES-GCM', false, ['decrypt']);
	const plain = await crypto.subtle.decrypt(
		{ name: 'AES-GCM', iv: bytes.subarray(0, 12) },
		key,
		bytes.subarray(12)
	);
	const body = JSON.parse(td.decode(plain));
	return Array.isArray(body?.messages) ? body.messages : [];
}

const idOf = (m: StoredMessage) => `${m.conversationId}\u0000${m.key}`;

/** One of each, the backup's and this device's together. */
function merged(a: StoredMessage[], b: StoredMessage[]) {
	const all = new Map<string, StoredMessage>();
	for (const m of [...a, ...b]) all.set(idOf(m), m);
	return [...all.values()].sort((x, y) => x.at.localeCompare(y.at));
}

export class BackupKeeper {
	constructor(
		private store: BackupStore,
		private t: BackupTransport,
		private userId: string
	) {}

	/** Whether this device keeps the backup (it knows the PIN), and whether there is one. */
	async state() {
		const [local, remote] = await Promise.all([this.store.backupKeys(), this.t.status()]);
		return { here: Boolean(local), ...remote };
	}

	/** A PIN for a new backup (or another one, `replace`): what this device holds, in it. */
	async setPin(pin: string, replace = false) {
		if (!PIN.test(pin)) throw new Error('El PIN tiene que tener 6 cifras o más');
		const keys = await keysFromPin(this.userId, pin, this.t);
		await this.t.create({
			proof: keys.proof,
			blob: await seal(keys.enc, await this.store.allMessages()),
			replace
		});
		await this.store.setBackupKeys(keys);
	}

	/** In a new device: the PIN, and what was said before, here. How many came. */
	async restore(pin: string) {
		if (!PIN.test(pin)) throw new Error('El PIN tiene que tener 6 cifras o más');
		const keys = await keysFromPin(this.userId, pin, this.t);
		const { blob } = await this.t.open(keys.proof);
		const old = await unseal(keys.enc, blob);
		const here = new Set((await this.store.allMessages()).map(idOf));
		let added = 0;
		for (const m of old)
			if (!here.has(idOf(m))) {
				await this.store.addMessage({ ...m, mine: m.userId === this.userId });
				added++;
			}
		await this.store.setBackupKeys(keys);
		return added;
	}

	/** Brought up to date: the backup's and this device's together (another device may have saved). */
	async save() {
		const keys = await this.store.backupKeys();
		if (!keys) return false;
		try {
			const { blob } = await this.t.open(keys.proof);
			const all = merged(await unseal(keys.enc, blob), await this.store.allMessages());
			await this.t.save({ proof: keys.proof, blob: await seal(keys.enc, all) });
			return true;
		} catch (err) {
			// The PIN changed, or the backup was wiped: this device no longer keeps it.
			if (err instanceof Error && /no es ese|No hay copia/.test(err.message))
				await this.store.setBackupKeys(null);
			throw err;
		}
	}

	/** «He olvidado el PIN»: no backup, to set another one (what the devices hold, they keep). */
	async forget() {
		await this.t.forget();
		await this.store.setBackupKeys(null);
	}
}
