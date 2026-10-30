import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PERMITS } from 'comun/avatars.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { decide } from '#lib/server/kid-login.ts';

/** An adult's answer (#303): «Esta vez», «1 hora», «2 horas», «Hoy», or «no». */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { answer } = await request.json().catch(() => ({}));
	if (answer !== 'no' && !PERMITS.some((p) => p.id === answer)) error(400, 'Respuesta no válida');
	const result = await decide(await kitchenOf(locals.user!.id), params.id, answer);
	if (result === 'not-found') error(404, 'No encontrado');
	return json({ result });
};
