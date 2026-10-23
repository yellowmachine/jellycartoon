import { and, eq, inArray } from 'drizzle-orm';
import webpush, { WebPushError } from 'web-push';
import { ORIGIN } from '$app/env/private';
import { getAppSetting, setAppSetting } from '#lib/server/app-settings.ts';
import { db } from '#lib/server/db/index.ts';
import { pushSubscription } from '#lib/server/db/schema.ts';
import { log } from '#lib/server/log.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';

/**
 * The app's notices on the adults' phones, with the app closed: Web Push
 * (https://developer.mozilla.org/docs/Web/API/Push_API), sent with web-push
 * (https://github.com/web-push-libs/web-push). The VAPID keys that sign them are made the first
 * time and kept in the database, encrypted: nothing to add to the .env. The service worker
 * (src/service-worker) shows them.
 */

export interface PushMessage {
	title: string;
	body: string;
	/** A new one with the same tag replaces the one before on the phone. */
	tag: string;
	/** Opened when the notice is touched. */
	url: string;
	/** Seconds the push service keeps trying, if the phone is off. */
	ttl: number;
}

/**
 * A contact for the push services, as the protocol asks: the app's address, which has to be https
 * (or an email). At home over http the browsers do not allow Web Push anyway.
 */
const SUBJECT = ORIGIN.startsWith('https://') ? ORIGIN : 'mailto:jellycartoon@localhost';

type Keys = { publicKey: string; privateKey: string };
let keys: Promise<Keys> | null = null;

/** The VAPID keys: made once, and kept. */
function vapidKeys() {
	keys ??= (async () => {
		const saved = await getAppSetting('vapid_keys');
		const read = saved ? decrypt(saved) : null;
		if (read) return JSON.parse(read) as Keys;
		const made = webpush.generateVAPIDKeys();
		await setAppSetting('vapid_keys', encrypt(JSON.stringify(made)));
		log.info('avisos', 'Claves de los avisos (VAPID) creadas');
		return made;
	})().catch((error) => {
		keys = null;
		throw error;
	});
	return keys;
}

/** For the browser to subscribe: the public key. */
export async function publicKey() {
	return (await vapidKeys()).publicKey;
}

/** This browser, for this adult: replaces what it had (another adult on the same phone, say). */
export async function subscribe(
	userId: string,
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
	const row = {
		userId,
		endpoint: subscription.endpoint,
		p256dh: subscription.keys.p256dh,
		auth: subscription.keys.auth
	};
	await db
		.insert(pushSubscription)
		.values(row)
		.onConflictDoUpdate({ target: pushSubscription.endpoint, set: row });
}

export async function unsubscribe(userId: string, endpoint: string) {
	await db
		.delete(pushSubscription)
		.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
}

/** Whether this browser gets the notices, for this adult. */
export async function isSubscribed(userId: string, endpoint: string) {
	const [row] = await db
		.select({ id: pushSubscription.id })
		.from(pushSubscription)
		.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)));
	return Boolean(row);
}

/**
 * To every phone of these adults. Never fails: a notice that does not arrive is said in the
 * Registro, and a subscription the push service no longer knows (the app uninstalled, the
 * permission taken back) is forgotten.
 */
export async function notify(userIds: string[], message: PushMessage) {
	if (!userIds.length) return;
	try {
		const { publicKey, privateKey } = await vapidKeys();
		const subscriptions = await db
			.select()
			.from(pushSubscription)
			.where(inArray(pushSubscription.userId, userIds));
		await Promise.all(
			subscriptions.map(async (s) => {
				try {
					await webpush.sendNotification(
						{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
						JSON.stringify(message),
						{
							TTL: message.ttl,
							urgency: 'high',
							vapidDetails: { subject: SUBJECT, publicKey, privateKey }
						}
					);
				} catch (error) {
					if (
						error instanceof WebPushError &&
						(error.statusCode === 404 || error.statusCode === 410)
					) {
						await db.delete(pushSubscription).where(eq(pushSubscription.id, s.id));
						log.info('avisos', 'Un móvil ya no recibe avisos: olvidado', { userId: s.userId });
					} else log.warn('avisos', 'No se pudo mandar un aviso', { userId: s.userId, error });
				}
			})
		);
	} catch (error) {
		log.error('avisos', 'No se pudieron mandar los avisos', { error });
	}
}
