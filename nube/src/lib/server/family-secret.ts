import {
	SCW_ACCESS_KEY,
	SCW_DEFAULT_REGION,
	SCW_KMS_KEY_ID,
	SCW_SECRET_KEY
} from '$app/env/private';
import { envelope, isEnveloped, type Kms } from './envelope.ts';
import { decrypt, encrypt } from './secret-box.ts';

/**
 * A family's secrets (#326): its OpenRouter and openrouteservice keys, its house's key, its
 * Telegram bot's token and its children's credentials. With the KMS (the three SCW_* in env.ts),
 * kept with the family's own data key, wrapped by Scaleway's Key Manager (envelope.ts): a copy of
 * the database and of the `.env` is not enough to read them, as Key Manager only answers the VPS.
 * Without it, as before: secret-box.ts, with BETTER_AUTH_SECRET.
 *
 * What was kept before the KMS is read all the same (secret-box.ts's, without the `kms1.` prefix),
 * and scripts/kms-migrar.ts keeps it again with the KMS. Something kept with the KMS cannot be read
 * without it: once on, it stays on.
 */

export const kmsOn = Boolean(SCW_ACCESS_KEY && SCW_SECRET_KEY && SCW_KMS_KEY_ID);

/** Key Manager through Scaleway's own SDK; the family as associated data. */
async function scaleway(): Promise<Kms> {
	const { createClient } = await import('@scaleway/sdk-client');
	const { KeyManagerv1alpha1 } = await import('@scaleway/sdk-key-manager');
	const api = new KeyManagerv1alpha1.API(
		createClient({
			accessKey: SCW_ACCESS_KEY!,
			secretKey: SCW_SECRET_KEY!,
			defaultRegion: SCW_DEFAULT_REGION as 'fr-par'
		})
	);
	const keyId = SCW_KMS_KEY_ID!;
	const bound = (familyId: string) => Buffer.from(familyId).toString('base64');
	return {
		async wrap(key, familyId) {
			const { ciphertext } = await api.encrypt({
				keyId,
				plaintext: key.toString('base64'),
				associatedData: bound(familyId)
			});
			return ciphertext;
		},
		async unwrap(wrapped, familyId) {
			const { plaintext } = await api.decrypt({
				keyId,
				ciphertext: wrapped,
				associatedData: bound(familyId)
			});
			return Buffer.from(plaintext, 'base64');
		}
	};
}

/** The families' wrapped keys, in `family_data_key`: loaded only with the KMS on. */
async function keyStore() {
	const { asFamily } = await import('./family.ts');
	const { familyDataKey } = await import('./db/schema.ts');
	return {
		async get(familyId: string) {
			const [row] = await asFamily(familyId, (tx) =>
				tx.select({ wrapped: familyDataKey.wrapped }).from(familyDataKey)
			);
			return row?.wrapped ?? null;
		},
		async put(familyId: string, wrapped: string) {
			return asFamily(familyId, async (tx) => {
				await tx.insert(familyDataKey).values({ familyId, wrapped }).onConflictDoNothing();
				const [row] = await tx.select({ wrapped: familyDataKey.wrapped }).from(familyDataKey);
				return row!.wrapped;
			});
		}
	};
}

let box: Promise<ReturnType<typeof envelope>> | null = null;
const boxOf = () =>
	(box ??= Promise.all([scaleway(), keyStore()]).then(([kms, store]) => envelope({ kms, store })));

/**
 * Whether Key Manager wraps and unwraps as expected, with a key made for this alone and kept
 * nowhere: at the start, before anything is kept with it (kms-migrate.ts). Its problem, said.
 */
export async function checkKms(): Promise<string | null> {
	try {
		const kms = await scaleway();
		const probe = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
		const back = await kms.unwrap(await kms.wrap(probe, 'comprobacion'), 'comprobacion');
		return back.equals(probe) ? null : 'devuelve otra clave';
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/** `text`, to be kept for the family: with its data key if the KMS is on, else as before. */
export async function sealFor(familyId: string, text: string) {
	return kmsOn ? (await boxOf()).seal(familyId, text) : encrypt(text);
}

/**
 * What was kept, read back; null if it cannot be (BETTER_AUTH_SECRET or the key changed). Kept
 * with the KMS and the KMS not answering: null too, said in the log, as the family's AI or house
 * goes without it until it answers.
 */
export async function openFor(familyId: string, value: string) {
	if (!isEnveloped(value)) return decrypt(value);
	if (!kmsOn) {
		console.error('[kms] Un secreto guardado con el KMS, y el KMS sin configurar (SCW_*)');
		return null;
	}
	try {
		return await (await boxOf()).open(familyId, value);
	} catch (err) {
		console.error('[kms] No se pudo leer un secreto de la familia', {
			familyId,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

/**
 * A file of the family's Papeles (#384), to be kept: with its data key, and only with the KMS on.
 * Without it there is no sealing a file (`kmsOn`, and the pages say so): throws, and nothing is
 * kept, as it is never kept as it came.
 */
export async function sealFileFor(familyId: string, bytes: Uint8Array) {
	if (!kmsOn) throw new Error('Sin KMS no se cifran ficheros');
	return (await boxOf()).sealBytes(familyId, bytes);
}

/** What was kept, read back; null if it cannot be, or the KMS is not answering (said in the log). */
export async function openFileFor(familyId: string, sealed: Uint8Array) {
	if (!kmsOn) return null;
	try {
		return await (await boxOf()).openBytes(familyId, sealed);
	} catch (err) {
		console.error('[kms] No se pudo leer un fichero de la familia', {
			familyId,
			error: err instanceof Error ? err.message : String(err)
		});
		return null;
	}
}

/** Whether it is kept as the KMS would keep it now: for scripts/kms-migrar.ts. */
export const sealedNow = (value: string) => isEnveloped(value) === kmsOn;
