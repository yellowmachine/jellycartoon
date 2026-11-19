import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { backups } from '#lib/server/messages.ts';
import { MessagesProblem } from '#lib/server/messages-scope.ts';

/**
 * Mensajes (#551): this person's backup behind their PIN. The PIN never comes here: only blinded
 * (`evaluar`, one try) and the proof of it the device derives (its hash kept); the backup, encrypted.
 */
const str = (v: unknown) => (typeof v === 'string' ? v : '');

export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.user!.id;
	const b = await request.json().catch(() => null);
	try {
		switch (b?.action) {
			case 'estado': {
				const s = await backups.status(userId);
				return json({ ...s, updatedAt: s.updatedAt?.toISOString() ?? null });
			}
			case 'evaluar':
				return json({ evaluation: await backups.evaluate(userId, str(b.blinded)) });
			case 'crear':
				await backups.create(userId, {
					proof: str(b.proof),
					blob: str(b.blob),
					replace: b.replace === true
				});
				return json({ ok: true });
			case 'abrir':
				return json(await backups.open(userId, str(b.proof)));
			case 'guardar':
				await backups.save(userId, { proof: str(b.proof), blob: str(b.blob) });
				return json({ ok: true });
			case 'olvidar':
				await backups.forget(userId);
				return json({ ok: true });
		}
	} catch (err) {
		if (err instanceof MessagesProblem) error(400, err.message);
		throw err;
	}
	error(400, 'Orden no válida');
};
