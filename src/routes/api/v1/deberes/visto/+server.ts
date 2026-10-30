import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { watchedBy } from '#lib/server/homework-source.ts';
import { cloudKid, cloudPerson, KID_EMAIL } from '#lib/server/media-api.ts';

/**
 * Homework (#142, prepared in Seilide): what one of the cloud's children watched lately, for an
 * adult to choose from (`{ "peque": { "email": "…@peques.invalid", "nombre": "Lucía" } }`).
 */
export const POST: RequestHandler = async ({ request }) => {
	await cloudPerson(request);
	const { peque } = await request.json().catch(() => ({}));
	const email = typeof peque?.email === 'string' ? peque.email.trim().toLowerCase() : '';
	if (!KID_EMAIL.test(email)) error(400, 'Falta el peque');
	const kid = await cloudKid(email, String(peque.nombre ?? '').slice(0, 60) || 'Peque');
	return json({ visto: await watchedBy(kid.id) });
};
