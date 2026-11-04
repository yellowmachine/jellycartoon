import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption (#326): each family's secrets with a data key of its own (AES-256-GCM), and
 * that key kept only wrapped by a KMS, bound to the family. Here only the logic, with what it needs
 * given (`EnvelopeDeps`): family-secret.ts gives it Scaleway's Key Manager and the database, the
 * tests a fake KMS and a Map.
 */

/** What wraps and unwraps a data key, bound to its family (the KMS's associated data). */
export interface Kms {
	wrap(key: Buffer, familyId: string): Promise<string>;
	unwrap(wrapped: string, familyId: string): Promise<Buffer>;
}

/** Where each family's wrapped key is kept: `put` keeps the first one, and gives back the kept one. */
export interface KeyStore {
	get(familyId: string): Promise<string | null>;
	put(familyId: string, wrapped: string): Promise<string>;
}

export interface EnvelopeDeps {
	kms: Kms;
	store: KeyStore;
	/** How long an unwrapped key is kept in memory: one call to the KMS per family in this time. */
	cacheMs?: number;
	now?: () => number;
}

/** What a secret kept this way starts with; anything else is secret-box.ts's, as before. */
export const PREFIX = 'kms1.';

export const isEnveloped = (value: string) => value.startsWith(PREFIX);

const CACHE_MS = 10 * 60_000;

export function envelope({ kms, store, cacheMs = CACHE_MS, now = Date.now }: EnvelopeDeps) {
	/** Unwrapped, by family, while they last; and those being asked for, once each. */
	const cache = new Map<string, { key: Buffer; until: number }>();
	const asking = new Map<string, Promise<Buffer>>();

	async function fetchKey(familyId: string, make: boolean): Promise<Buffer | null> {
		const kept = await store.get(familyId);
		if (kept) return kms.unwrap(kept, familyId);
		if (!make) return null;
		const fresh = randomBytes(32);
		const mine = await kms.wrap(fresh, familyId);
		// Unwrapped back before it is kept: a KMS that wraps but cannot unwrap (a wrong encoding, a
		// missing permission) must not leave the family's secrets kept with a key no one can read.
		if (!(await kms.unwrap(mine, familyId)).equals(fresh))
			throw new Error('El KMS no devuelve la clave que envolvió');
		// Two servers at once: the first one's is the one kept, and the one used.
		const stored = await store.put(familyId, mine);
		return stored === mine ? fresh : kms.unwrap(stored, familyId);
	}

	/** The family's key; with `make`, made if it has none. Null without one. Throws if the KMS fails. */
	async function keyOf(familyId: string, make: boolean): Promise<Buffer | null> {
		const hit = cache.get(familyId);
		if (hit && hit.until > now()) return hit.key;
		// One question at a time, by family and by whether it may make one.
		const ask = `${familyId}|${make}`;
		let pending = asking.get(ask);
		if (!pending) {
			pending = fetchKey(familyId, make).then((key) => {
				if (!key) throw new NoKey();
				cache.set(familyId, { key, until: now() + cacheMs });
				return key;
			});
			asking.set(ask, pending);
			pending.finally(() => asking.delete(ask)).catch(() => {});
		}
		try {
			return await pending;
		} catch (err) {
			if (err instanceof NoKey) return null;
			throw err;
		}
	}

	return {
		/** `text` kept for the family: `kms1.iv.tag.data`, in base64url, bound to the family. */
		async seal(familyId: string, text: string) {
			const key = (await keyOf(familyId, true))!;
			const iv = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			cipher.setAAD(Buffer.from(familyId));
			const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
			return PREFIX + [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
		},
		/** Read back; null if it cannot be (another family's, changed). Throws if the KMS fails. */
		async open(familyId: string, value: string) {
			const key = await keyOf(familyId, false);
			if (!key) return null;
			try {
				const [iv, tag, data] = value
					.slice(PREFIX.length)
					.split('.')
					.map((p) => Buffer.from(p, 'base64url'));
				const decipher = createDecipheriv('aes-256-gcm', key, iv!);
				decipher.setAAD(Buffer.from(familyId));
				decipher.setAuthTag(tag!);
				return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
			} catch {
				return null;
			}
		},
		/** A file kept for the family (Papeles, #384): `iv`, `tag` and the data, bound to the family. */
		async sealBytes(familyId: string, bytes: Uint8Array) {
			const key = (await keyOf(familyId, true))!;
			const iv = randomBytes(12);
			const cipher = createCipheriv('aes-256-gcm', key, iv);
			cipher.setAAD(Buffer.from(familyId));
			const data = Buffer.concat([cipher.update(bytes), cipher.final()]);
			return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), data]));
		},
		/** Read back; null if it cannot be (another family's, changed). Throws if the KMS fails. */
		async openBytes(familyId: string, sealed: Uint8Array) {
			const key = await keyOf(familyId, false);
			if (!key) return null;
			try {
				const bytes = Buffer.from(sealed);
				const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
				decipher.setAAD(Buffer.from(familyId));
				decipher.setAuthTag(bytes.subarray(12, 28));
				return new Uint8Array(
					Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()])
				);
			} catch {
				return null;
			}
		},
		/** Forgotten from memory: the next one asks the KMS again. */
		forget: () => cache.clear()
	};
}

class NoKey extends Error {}
