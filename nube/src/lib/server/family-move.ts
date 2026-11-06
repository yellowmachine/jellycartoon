import { db } from './db/index.ts';
import { sendUnlinked } from './emails.ts';
import { familyMoveScope } from './family-move-scope.ts';
import { tell } from './inbox.ts';

const moves = familyMoveScope(db);

/**
 * Out of the family, with what is theirs (#315; family-move-scope.ts). Whoever was unlinked is told
 * by email; who administers, when someone left and if a child has no adult left.
 */
export async function leaveFamily(by: string, userId: string) {
	const done = await moves.leave(by, userId).catch((error) => {
		console.error('[familias] No se pudo salir de la familia:', error);
		return {
			ok: false,
			problem: 'No se pudo hacer, y no ha cambiado nada. Prueba otra vez'
		} as const;
	});
	if (!done.ok) return done;
	if (by !== userId)
		await sendUnlinked({
			to: done.email,
			oldFamily: done.oldFamilyName,
			family: done.familyName
		}).catch((error) => console.error('[familias] El correo de desvincular no salió:', error));
	const noAdult = done.orphanKids.length
		? ` Era quien dejaba entrar a ${done.orphanKids.join(', ')}: elige a otro adulto en Ajustes.`
		: '';
	if ((by === userId || noAdult) && done.admins.length)
		await tell(done.oldFamilyId, done.admins, {
			kind: 'recado',
			title: `${done.name} ya no está en la familia`,
			body: `${done.name} ha salido de la familia.${noAdult}`,
			url: '/ajustes?seccion=familia#personas',
			tag: `salio-${userId}`,
			ttl: 7 * 24 * 60 * 60
		});
	return done;
}
