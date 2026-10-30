import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { user } from '#lib/server/db/schema.ts';
import { houseRequest } from '#lib/server/house-keys.ts';
import { learnFromTelegram } from '#lib/server/learn.ts';

/**
 * A message of one of the chats a person chose to learn from (#331, phase 5), sent or received,
 * passed by their house in their name: read afterwards (learn.ts), so the house is not kept
 * waiting. Only for a person of the family.
 */
export const POST: RequestHandler = async ({ request }) => {
	const k = await houseRequest(request);
	if (!k.userId) error(403, 'Solo en nombre de alguien de la familia');
	const body = await request.json().catch(() => null);
	const chat = typeof body?.chat === 'string' ? body.chat.trim().slice(0, 120) : '';
	const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 2000) : '';
	const from = typeof body?.from === 'string' ? body.from.trim().slice(0, 80) : null;
	if (!chat || !text) error(400, 'Falta el chat o el mensaje');
	const userId = k.userId;
	const [me] = await k.run((tx) =>
		tx.select({ name: user.name }).from(user).where(eq(user.id, userId))
	);
	void learnFromTelegram(k, userId, me?.name ?? 'alguien', { chat, from, text }).catch((err) =>
		console.warn('[aprender] No se pudo leer', { error: String(err) })
	);
	return json({ ok: true });
};
