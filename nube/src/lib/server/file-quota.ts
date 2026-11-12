import { eq } from 'drizzle-orm';
import { STORAGE_QUOTA_MB } from '$app/env/private';
import { db } from './db/index.ts';
import { familyMember } from './db/schema.ts';
import { asFamily } from './family.ts';
import { fileQuotaScope } from './file-quota-scope.ts';
import { tell } from './inbox.ts';
import { sizeText } from '#lib/storage-size.ts';

/** Each family's storage quota (#480), as the app's role: file-quota-scope.ts. */
export const fileQuota = fileQuotaScope(db, { defaultBytes: STORAGE_QUOTA_MB * 1024 * 1024 });

/** What a family that has no room left is told when it tries to keep something more. */
export const fullText = (limit: number) =>
	`La familia ha llenado su espacio (${sizeText(limit)}). Borra fotos, notas de voz o papeles que ya no hagan falta.`;

const adminsOf = async (familyId: string) =>
	(
		await asFamily(familyId, (tx) =>
			tx
				.select({ id: familyMember.userId })
				.from(familyMember)
				.where(eq(familyMember.role, 'admin'))
		)
	).map((a) => a.id);

/** Past WARN_AT: told once to who runs the family, as the AI stopped (ai-stopped.ts). */
export async function warnAlmostFull(familyId: string) {
	const { used, limit } = await fileQuota.usage(familyId);
	await tell(familyId, await adminsOf(familyId), {
		kind: 'espacio',
		title: 'El espacio de la familia está casi lleno',
		body: `Lleváis ${sizeText(used)} de ${sizeText(limit)}. Cuando se llene no se podrán guardar más fotos, notas de voz, tickets ni papeles.`,
		tag: `espacio-${familyId}`,
		url: '/ajustes?seccion=familia#espacio',
		ttl: 7 * 24 * 60 * 60
	});
}

/** When each family was last told its own storage fails: once a day at most. */
const toldFailing = new Map<string, number>();
const TELL_FAILING_MS = 24 * 60 * 60 * 1000;

/** Its own storage (#480, phase 2) failing: to who runs the family, so it is not taken for Seilide's. */
export async function warnOwnStorage(familyId: string, problem: string) {
	const last = toldFailing.get(familyId) ?? 0;
	if (Date.now() - last < TELL_FAILING_MS) return;
	toldFailing.set(familyId, Date.now());
	await tell(familyId, await adminsOf(familyId), {
		kind: 'espacio',
		title: 'Vuestro almacenamiento no responde',
		body: `${problem}. Mientras tanto no se pueden ver ni guardar fotos, notas de voz, tickets ni papeles. Revísalo en Ajustes → Familia → Espacio.`,
		tag: `espacio-propio-${familyId}`,
		url: '/ajustes?seccion=familia#espacio',
		ttl: 24 * 60 * 60
	});
}

/** A move between storages that stopped or ended (storage-move.ts), to who runs the family. */
export async function tellMove(familyId: string, title: string, body: string) {
	await tell(familyId, await adminsOf(familyId), {
		kind: 'espacio',
		title,
		body,
		tag: `espacio-paso-${familyId}`,
		url: '/ajustes?seccion=familia#espacio',
		ttl: 7 * 24 * 60 * 60
	});
}
