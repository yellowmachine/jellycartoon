import { and, eq } from 'drizzle-orm';
import { envelope, isEnveloped, type Kms } from './envelope.ts';
import type { AnyDb } from './family-scope.ts';
import { userDataKey, userSecret } from './db/user.schema.ts';

/**
 * A person's secrets (#428), of no family: each with their own data key, wrapped by the KMS and
 * bound to them, so they go with the person when they leave or join a family, and nothing is
 * sealed again. Without the KMS, as a family's without it: `plain`, secret-box.ts.
 *
 * As with a family's, what was kept without the KMS is read all the same, but stays as it was once
 * the KMS is on (kms-migrate.ts only goes through the families').
 */

/** In what the KMS and the data key are bound to: not to be taken for a family's id. */
const BOUND = 'user:';

export interface UserSecretDeps {
	asUser: <T>(userId: string, fn: (tx: AnyDb) => Promise<T>) => Promise<T>;
	/** Null: without the KMS. */
	kms: (() => Promise<Kms>) | null;
	plain: { encrypt: (text: string) => string; decrypt: (value: string) => string | null };
}

export function userSecrets({ asUser, kms, plain }: UserSecretDeps) {
	const idOf = (bound: string) => bound.slice(BOUND.length);

	let box: Promise<ReturnType<typeof envelope>> | null = null;
	const boxOf = (make: () => Promise<Kms>) =>
		(box ??= make().then((client) =>
			envelope({
				kms: client,
				store: {
					async get(bound) {
						const [row] = await asUser(idOf(bound), (tx) =>
							tx.select({ wrapped: userDataKey.wrapped }).from(userDataKey)
						);
						return row?.wrapped ?? null;
					},
					async put(bound, wrapped) {
						const userId = idOf(bound);
						return asUser(userId, async (tx) => {
							await tx.insert(userDataKey).values({ userId, wrapped }).onConflictDoNothing();
							const [row] = await tx.select({ wrapped: userDataKey.wrapped }).from(userDataKey);
							return row!.wrapped;
						});
					}
				}
			})
		));

	return {
		/** A secret of theirs, read back; null if there is none or it cannot be read (in the log). */
		async get(userId: string, name: string) {
			const [row] = await asUser(userId, (tx) =>
				tx
					.select({ value: userSecret.value })
					.from(userSecret)
					.where(and(eq(userSecret.userId, userId), eq(userSecret.name, name)))
			);
			if (!row) return null;
			if (!isEnveloped(row.value)) return plain.decrypt(row.value);
			if (!kms) {
				console.error('[kms] Un secreto guardado con el KMS, y el KMS sin configurar (SCW_*)');
				return null;
			}
			try {
				return await (await boxOf(kms)).open(BOUND + userId, row.value);
			} catch (err) {
				console.error('[kms] No se pudo leer un secreto de una persona', {
					userId,
					error: err instanceof Error ? err.message : String(err)
				});
				return null;
			}
		},
		/** Kept, in place of the one before; null, forgotten. */
		async set(userId: string, name: string, text: string | null) {
			if (text === null) {
				await asUser(userId, (tx) =>
					tx.delete(userSecret).where(and(eq(userSecret.userId, userId), eq(userSecret.name, name)))
				);
				return;
			}
			// Sealed outside the transaction: the KMS may take asking.
			const value = kms ? await (await boxOf(kms)).seal(BOUND + userId, text) : plain.encrypt(text);
			await asUser(userId, (tx) =>
				tx
					.insert(userSecret)
					.values({ userId, name, value })
					.onConflictDoUpdate({
						target: [userSecret.userId, userSecret.name],
						set: { value, updatedAt: new Date() }
					})
			);
		}
	};
}
