import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { answerExercise } from '#lib/server/homework.ts';

/**
 * A child's answer to one exercise of their homework (#142): `{ index, answer }`, an option's
 * index or their own words. Checked here, so that the page never has the right one beforehand.
 */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	const index = Number(body?.index);
	const answer = body?.answer;
	if (!Number.isInteger(index) || (typeof answer !== 'number' && typeof answer !== 'string'))
		error(400, 'Bad request');
	const done = await answerExercise(Number(params.id), locals.user!.id, index, answer);
	if (!done) error(409, 'No se puede contestar');
	return json(done);
};
