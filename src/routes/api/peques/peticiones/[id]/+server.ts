import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { decide } from '#lib/server/kid-login.ts';
import { PERMITS } from '#lib/avatars.ts';

/** A parent's answer: «Esta vez», «1 hora», «2 horas», «Hoy», or «no». */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const { answer } = await request.json();
	if (answer !== 'no' && !PERMITS.some((p) => p.id === answer)) error(400, 'Respuesta no válida');
	const result = await decide(params.id, locals.user!.id, answer);
	if (result === 'not-found') error(404, 'No encontrado');
	return json({ result });
};
