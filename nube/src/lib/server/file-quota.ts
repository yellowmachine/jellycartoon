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

/** Past WARN_AT: told once to who runs the family, as the AI stopped (ai-stopped.ts). */
export async function warnAlmostFull(familyId: string) {
	const { used, limit } = await fileQuota.usage(familyId);
	const admins = await asFamily(familyId, (tx) =>
		tx.select({ id: familyMember.userId }).from(familyMember).where(eq(familyMember.role, 'admin'))
	);
	await tell(
		familyId,
		admins.map((a) => a.id),
		{
			kind: 'espacio',
			title: 'El espacio de la familia está casi lleno',
			body: `Lleváis ${sizeText(used)} de ${sizeText(limit)}. Cuando se llene no se podrán guardar más fotos, notas de voz, tickets ni papeles.`,
			tag: `espacio-${familyId}`,
			url: '/ajustes?seccion=familia#espacio',
			ttl: 7 * 24 * 60 * 60
		}
	);
}
