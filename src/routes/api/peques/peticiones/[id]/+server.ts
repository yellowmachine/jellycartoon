import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isKid } from '#lib/server/kids.ts';
import { decide } from '#lib/server/kid-login.ts';
import { PERMITS } from 'comun/avatars.ts';

/**
 * A parent's answer: «Esta vez», «1 hora», «2 horas», «Hoy», or «no»; with `companions`, the other
 * children let in with it, to watch together (#160).
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (isKid(locals.user)) error(404, 'No encontrado');
	const { answer, companions } = await request.json();
	if (answer !== 'no' && !PERMITS.some((p) => p.id === answer)) error(400, 'Respuesta no válida');
	const together = Array.isArray(companions)
		? companions.filter((c): c is string => typeof c === 'string').slice(0, 20)
		: [];
	const result = await decide(params.id, locals.user!.id, answer, together);
	if (result === 'not-found') error(404, 'No encontrado');
	return json({ result });
};
