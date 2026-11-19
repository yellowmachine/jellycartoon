import { eq } from 'drizzle-orm';
import { Oprf, OPRFServer, EvaluationRequest, randomPrivateKey } from '@cloudflare/voprf-ts';
import { msgBackup } from './db/schema.ts';
import type { familyScope } from './family-scope.ts';
import { MessagesProblem } from './messages-scope.ts';

/**
 * Mensajes (#551): each person's backup of what their devices read, behind their PIN. The device
 * blinds the PIN and Seilide evaluates it with this person's OPRF key (RFC 9497), counting each try;
 * from the result the device takes two keys, one to encrypt the backup and one to prove it knows the
 * PIN, of which Seilide keeps only the hash. With only the database nobody can try PINs: each try
 * goes through here. After `MAX_TRIES` without the right one, the backup is wiped. Apart from the
 * app's database and its KMS (`seal`, `open`), to be tested on PGlite.
 */

export const SUITE = Oprf.Suite.P256_SHA256;
export const MAX_TRIES = 10;
/** The backup's size: text for years; audios go apart, only their keys in it. */
export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;

export interface Sealer {
	seal(familyId: string, text: string): Promise<string>;
	open(familyId: string, sealed: string): Promise<string | null>;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

async function hash(proof: string) {
	return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', unb64(proof))));
}

/** Without telling by its time how much of it matched. */
function same(a: string, b: string) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

export function messagesBackupScope(withFamily: ReturnType<typeof familyScope>, sealer: Sealer) {
	const freshKey = async (familyId: string) =>
		sealer.seal(familyId, b64(await randomPrivateKey(SUITE)));

	/** Its proof right: the tries back to 0. Else a problem. */
	async function proven(userId: string, proof: string) {
		return withFamily(userId, async (tx) => {
			const [row] = await tx.select().from(msgBackup).where(eq(msgBackup.userId, userId));
			if (!row?.verifier) throw new MessagesProblem('No hay copia de tus mensajes');
			if (!same(await hash(proof), row.verifier)) throw new MessagesProblem('El PIN no es ese');
			await tx.update(msgBackup).set({ tries: 0 }).where(eq(msgBackup.userId, userId));
			return row;
		});
	}

	return {
		/** Whether there is a backup, and how many tries are left. */
		async status(userId: string) {
			return withFamily(userId, async (tx) => {
				const [row] = await tx.select().from(msgBackup).where(eq(msgBackup.userId, userId));
				return {
					backup: Boolean(row?.verifier),
					triesLeft: MAX_TRIES - (row?.tries ?? 0),
					updatedAt: row?.verifier ? row.updatedAt : null
				};
			});
		},

		/**
		 * The PIN, blinded, evaluated: one try. Too many since the last right one, the backup is wiped
		 * (and the key changed) before saying so.
		 */
		async evaluate(userId: string, blinded: string) {
			let request: EvaluationRequest;
			try {
				request = EvaluationRequest.deserialize(SUITE, unb64(blinded));
			} catch {
				throw new MessagesProblem('Petición no válida');
			}
			const key = await withFamily(userId, async (tx, m) => {
				const [row] = await tx.select().from(msgBackup).where(eq(msgBackup.userId, userId));
				if (!row) {
					const oprfKey = await freshKey(m.familyId);
					await tx.insert(msgBackup).values({ userId, familyId: m.familyId, oprfKey, tries: 1 });
					return { familyId: m.familyId, sealed: oprfKey };
				}
				if (row.tries >= MAX_TRIES) {
					await tx
						.update(msgBackup)
						.set({
							verifier: null,
							blob: null,
							tries: 0,
							oprfKey: await freshKey(m.familyId),
							updatedAt: new Date()
						})
						.where(eq(msgBackup.userId, userId));
					console.warn('[mensajes] Copia borrada por demasiados intentos de PIN', { userId });
					return null;
				}
				await tx
					.update(msgBackup)
					.set({ tries: row.tries + 1 })
					.where(eq(msgBackup.userId, userId));
				return { familyId: m.familyId, sealed: row.oprfKey };
			});
			if (!key)
				throw new MessagesProblem('Demasiados intentos: la copia se ha borrado. Pon un PIN nuevo.');
			const raw = await sealer.open(key.familyId, key.sealed);
			if (!raw)
				throw new MessagesProblem('No se puede abrir la llave de la copia ahora: prueba más tarde');
			const evaluation = await new OPRFServer(SUITE, unb64(raw)).blindEvaluate(request);
			return b64(evaluation.serialize());
		},

		/** A new backup (or another PIN): its proof's hash and the first ciphertext. */
		async create(userId: string, c: { proof: string; blob: string; replace: boolean }) {
			if (c.blob.length > MAX_BACKUP_BYTES * 1.4)
				throw new MessagesProblem('La copia es demasiado grande');
			const verifier = await hash(c.proof);
			return withFamily(userId, async (tx) => {
				const [row] = await tx.select().from(msgBackup).where(eq(msgBackup.userId, userId));
				if (!row) throw new MessagesProblem('Primero el PIN');
				if (row.verifier && !c.replace)
					throw new MessagesProblem('Ya tienes copia: recupérala con tu PIN');
				await tx
					.update(msgBackup)
					.set({ verifier, blob: c.blob, tries: 0, updatedAt: new Date() })
					.where(eq(msgBackup.userId, userId));
			});
		},

		/** The backup, to a device that knows the PIN. */
		async open(userId: string, proof: string) {
			const row = await proven(userId, proof);
			return { blob: row.blob ?? '', updatedAt: row.updatedAt };
		},

		/** Brought up to date, by a device that knows the PIN. */
		async save(userId: string, c: { proof: string; blob: string }) {
			if (c.blob.length > MAX_BACKUP_BYTES * 1.4)
				throw new MessagesProblem('La copia es demasiado grande');
			await proven(userId, c.proof);
			await withFamily(userId, (tx) =>
				tx
					.update(msgBackup)
					.set({ blob: c.blob, updatedAt: new Date() })
					.where(eq(msgBackup.userId, userId))
			);
		},

		/** «He olvidado el PIN»: no backup, to start again (what the devices hold, they keep). */
		async forget(userId: string) {
			await withFamily(userId, (tx) => tx.delete(msgBackup).where(eq(msgBackup.userId, userId)));
		}
	};
}

export type MessagesBackupScope = ReturnType<typeof messagesBackupScope>;
