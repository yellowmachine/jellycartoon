import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import { noteAsking, noteStopped, noteTouched } from '#lib/server/live-watching.ts';
import { askAfter, askAfterChoice, setAskAfter } from '#lib/server/still-there.ts';

/**
 * The video API (#253): «¿Sigues ahí?» (#77) from the cloud, for this person (a child too, #303).
 * GET, after how many minutes it asks (`{ askAfter }`, null: never); PUT `{ askAfter }` changes
 * it, as Ajustes or /infantil at home; POST `{ state }` says what happened in the cloud's player
 * (asked, answered, stopped, or someone touching something: `here`), for /infantil's «Ahora».
 */
export const GET: RequestHandler = async ({ request }) => {
	const person = await cloudViewer(request);
	return json({ askAfter: await askAfter(person.id) });
};

export const PUT: RequestHandler = async ({ request }) => {
	const person = await cloudViewer(request);
	const body = await request.json().catch(() => null);
	const minutes = askAfterChoice(body?.askAfter);
	if (minutes === undefined) error(400, 'Valor no válido');
	await setAskAfter(person.id, minutes);
	return json({ askAfter: minutes });
};

export const POST: RequestHandler = async ({ request }) => {
	const person = await cloudViewer(request);
	const { state } = (await request.json().catch(() => null)) ?? {};
	if (state === 'asking') noteAsking(person.id, true);
	else if (state === 'answered') noteAsking(person.id, false);
	else if (state === 'stopped') noteStopped(person.id);
	else if (state === 'here') noteTouched(person.id);
	else error(400, 'Bad request');
	return json({ ok: true });
};
