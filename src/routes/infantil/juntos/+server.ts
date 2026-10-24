import { error, json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/schema.ts';
import { mayDecide } from '#lib/server/kid-login.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { addCompanions, removeCompanion, togetherOf } from '#lib/server/watching-together.ts';

/**
 * From «Ahora» (/infantil), an adult adds a child to watch with the one on the TV, or takes it off
 * (#160): `{ kidId, companionId, add }`. Added, only one free (not watching on its own device) and
 * whom this adult may let in. Adults only, as the rest of /infantil (see kids.ts).
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const { kidId, companionId, add } = body ?? {};
	if (typeof kidId !== 'string' || typeof companionId !== 'string' || typeof add !== 'boolean')
		error(400, 'Bad request');
	const kids = await db
		.select({ id: user.id })
		.from(user)
		.where(and(inArray(user.id, [kidId, companionId]), eq(user.role, KIDS_ROLE)));
	if (kids.length !== 2) error(404, 'No encontrado');
	const adultId = locals.user!.id;
	if (!add) {
		await removeCompanion(kidId, companionId, adultId);
		return json({ ok: true });
	}
	const [together] = await togetherOf([kidId]);
	if (!together?.available.some((k) => k.id === companionId))
		error(409, 'Ahora está viendo otra cosa');
	if (!(await mayDecide(adultId, companionId))) error(403, 'No puedes dejarle entrar');
	if (!(await addCompanions(kidId, [companionId], adultId))) error(409, 'No está en la tele');
	return json({ ok: true });
};
