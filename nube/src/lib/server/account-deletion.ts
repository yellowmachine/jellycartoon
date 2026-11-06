import { accountDeletionScope, type DeletionPlan } from './account-deletion-scope.ts';
import { db } from './db/index.ts';
import { removeAllFiles, removeFile } from './storage.ts';

/**
 * «Eliminar mi cuenta» (#315), with Better Auth's own deletion (auth.ts): this, around it. What is
 * to be removed is known before the account goes, and removed after it has, so a failure on the way
 * leaves nothing pointing at a file that is not there.
 */
export const accountDeletion = accountDeletionScope(db);

const plans = new Map<string, DeletionPlan>();

export async function beforeDeleteAccount(person: { id: string; email: string; name: string }) {
	plans.set(person.id, await accountDeletion.prepare(person.id, person.email, person.name));
}

export async function afterDeleteAccount(person: { id: string; name: string; email: string }) {
	const plan = plans.get(person.id);
	plans.delete(person.id);
	const { sendAccountDeleted } = await import('./emails.ts');
	await sendAccountDeleted(person.email).catch((error) =>
		console.error('[cuentas] El correo de despedida no salió:', error)
	);
	if (!plan?.familyId) return;
	const familyId = plan.familyId;
	if (plan.familyGone) {
		await removeAllFiles(familyId).catch((error) =>
			console.warn('[cuentas] No se pudieron borrar los ficheros de la familia', String(error))
		);
		return;
	}
	for (const { area, name } of plan.files)
		await removeFile(familyId, area, name).catch((error) =>
			console.warn('[cuentas] No se pudo borrar un fichero', String(error))
		);
	if (plan.orphanKids.length && plan.admins.length) {
		const { tell } = await import('./inbox.ts');
		await tell(familyId, plan.admins, {
			kind: 'recado',
			title: 'Hay peques sin adulto',
			body: `${person.name} ha eliminado su cuenta y era quien dejaba entrar a ${plan.orphanKids.join(', ')}. Elige a otro adulto en Ajustes.`,
			url: '/ajustes?seccion=familia#personas',
			tag: 'peques-sin-adulto',
			ttl: 7 * 24 * 60 * 60
		});
	}
}
