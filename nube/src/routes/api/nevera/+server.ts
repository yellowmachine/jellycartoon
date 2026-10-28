import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	addItems,
	addNote,
	clearDone,
	editNote,
	peelNote,
	kitchenOf,
	removeItem,
	setItemDone,
	today
} from '#lib/server/fridge.ts';

/** Up to a year: a post-it is not a calendar. */
const MAX_DAYS = 366;

/** `YYYY-MM-DD`, from today to a year from now; anything else, not a day. */
function untilDay(value: unknown) {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
		error(400, 'Fecha no válida');
	const from = today();
	const last = new Date(`${from}T12:00:00Z`);
	last.setUTCDate(last.getUTCDate() + MAX_DAYS);
	if (value < from || value > last.toISOString().slice(0, 10)) error(400, 'Fecha no válida');
	return value;
}

const id = (value: unknown) => {
	if (!Number.isInteger(value)) error(400, 'Petición no válida');
	return value as number;
};

/**
 * What is done on the family's fridge: a post-it up, changed or peeled off; items onto the list,
 * ticked off, removed, or what was bought cleared. The open pages learn it by /api/nevera/events.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const k = await kitchenOf(locals.user!.id);
	const body = await request.json().catch(() => null);
	switch (body?.action) {
		case 'note': {
			if (typeof body.text !== 'string' || !body.text.trim()) error(400, 'Falta el texto');
			return json({ id: await addNote(k, body.text, untilDay(body.until)) });
		}
		case 'edit': {
			if (typeof body.text !== 'string' || !body.text.trim()) error(400, 'Falta el texto');
			if (!(await editNote(k, id(body.id), body.text)))
				error(404, 'Ese post-it ya no está en la nevera');
			return json({ ok: true });
		}
		case 'peel':
			await peelNote(k, id(body.id));
			return json({ ok: true });
		case 'add': {
			const items = Array.isArray(body.items) ? body.items : [body.text];
			if (!items.every((t: unknown) => typeof t === 'string') || items.length > 50)
				error(400, 'Petición no válida');
			return json({ added: await addItems(k, items) });
		}
		case 'done':
			await setItemDone(k, id(body.id), Boolean(body.done));
			return json({ ok: true });
		case 'remove':
			await removeItem(k, id(body.id));
			return json({ ok: true });
		case 'clear':
			await clearDone(k);
			return json({ ok: true });
		default:
			error(400, 'Petición no válida');
	}
};
