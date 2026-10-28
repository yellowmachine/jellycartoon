import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isSubscribed, publicKey, subscribe, unsubscribe } from '#lib/server/push.ts';

/** The family's notices on this phone (Web Push, push.ts): the key to subscribe, and whether it is. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const endpoint = url.searchParams.get('endpoint');
	return json({
		publicKey: await publicKey(),
		subscribed: endpoint ? await isSubscribed(locals.user!.id, endpoint) : false
	});
};

const isSubscription = (
	s: unknown
): s is { endpoint: string; keys: { p256dh: string; auth: string } } =>
	!!s &&
	typeof s === 'object' &&
	typeof (s as { endpoint?: unknown }).endpoint === 'string' &&
	/^https:\/\//.test((s as { endpoint: string }).endpoint) &&
	typeof (s as { keys?: { p256dh?: unknown } }).keys?.p256dh === 'string' &&
	typeof (s as { keys?: { auth?: unknown } }).keys?.auth === 'string';

/** On: what the browser's push service gave (PushSubscription.toJSON()). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const subscription = await request.json();
	if (!isSubscription(subscription)) error(400, 'Suscripción no válida');
	await subscribe(locals.user!.id, subscription);
	return json({ ok: true });
};

/** Off, on this phone. */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { endpoint } = await request.json();
	if (typeof endpoint !== 'string') error(400, 'Petición no válida');
	await unsubscribe(locals.user!.id, endpoint);
	return json({ ok: true });
};
