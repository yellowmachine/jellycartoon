import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { BETTER_AUTH_SECRET } from '$app/env/private';

/**
 * Secrets the app keeps in the database and must read back (a child's credential, #141; the Web
 * Push keys): encrypted with AES-256-GCM, with a key of their own derived from BETTER_AUTH_SECRET
 * (HKDF). Never the secret itself, and nothing a copy of the database has.
 */
const KEY = Buffer.from(
	hkdfSync('sha256', BETTER_AUTH_SECRET, 'jellycartoon', 'kid credential', 32)
);

/** `iv.tag.data`, in base64url. */
export function encrypt(text: string) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', KEY, iv);
	const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
	return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

/** Null if it cannot be read: BETTER_AUTH_SECRET changed. */
export function decrypt(value: string) {
	try {
		const [iv, tag, data] = value.split('.').map((p) => Buffer.from(p, 'base64url'));
		const decipher = createDecipheriv('aes-256-gcm', KEY, iv!);
		decipher.setAuthTag(tag!);
		return Buffer.concat([decipher.update(data!), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
}
