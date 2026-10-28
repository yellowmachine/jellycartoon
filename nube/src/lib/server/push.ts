import { and, eq, inArray } from 'drizzle-orm';
import webpush, { WebPushError } from 'web-push';
import { ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { pushSubscription, serviceSetting } from '#lib/server/db/schema.ts';
import { asFamily, withFamily } from '#lib/server/family.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';

/**
 * The family's notices on its people's phones, with the app closed (#253; jellycartoon's push.ts):
 * Web Push (https://developer.mozilla.org/docs/Web/API/Push_API), sent with web-push
 * (https://github.com/web-push-libs/web-push). The VAPID keys that sign them are the service's,
 * made the first time and kept in the database, encrypted: nothing to add to the .env. The service
 * worker (src/service-worker) shows them.
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
	/** On screen until touched or dismissed: someone is waiting for an answer. */
	sticky?: boolean;
}

/** A contact for the push services, as the protocol asks: the app's address, which is https. */
const SUBJECT = ORIGIN.startsWith('https://') ? ORIGIN : 'mailto:nube@localhost';

type Keys = { publicKey: string; privateKey: string };
let keys: Promise<Keys> | null = null;

async function savedKeys() {
	const [saved] = await db
		.select({ value: serviceSetting.value })
		.from(serviceSetting)
		.where(eq(serviceSetting.key, 'vapid_keys'));
	const read = saved ? decrypt(saved.value) : null;
	return read ? (JSON.parse(read) as Keys) : null;
}

/** The VAPID keys: made once, and kept. Two servers at once: the first one's stay. */
function vapidKeys(): Promise<Keys> {
	keys ??= (async () => {
		const saved = await savedKeys();
		if (saved) return saved;
		const made = webpush.generateVAPIDKeys();
		await db
			.insert(serviceSetting)
			.values({ key: 'vapid_keys', value: encrypt(JSON.stringify(made)) })
			.onConflictDoNothing();
		console.info('[avisos] Claves de los avisos (VAPID) creadas');
		return (await savedKeys()) ?? made;
	})().catch((error: unknown) => {
		keys = null;
		throw error;
	});
	return keys;
}

/** For the browser to subscribe: the public key. */
export async function publicKey() {
	return (await vapidKeys()).publicKey;
}

/** This browser, for this person: replaces what it had (another person on the same phone, say). */
export async function subscribe(
	userId: string,
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
) {
	await withFamily(userId, async (tx, { familyId }) => {
		const row = {
			familyId,
			userId,
			endpoint: subscription.endpoint,
			p256dh: subscription.keys.p256dh,
			auth: subscription.keys.auth
		};
		await tx
			.insert(pushSubscription)
			.values(row)
			.onConflictDoUpdate({ target: pushSubscription.endpoint, set: row });
	});
}

export async function unsubscribe(userId: string, endpoint: string) {
	await withFamily(userId, (tx) =>
		tx
			.delete(pushSubscription)
			.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)))
	);
}

/** Whether this browser gets the notices, for this person. */
export async function isSubscribed(userId: string, endpoint: string) {
	const [row] = await withFamily(userId, (tx) =>
		tx
			.select({ id: pushSubscription.id })
			.from(pushSubscription)
			.where(and(eq(pushSubscription.userId, userId), eq(pushSubscription.endpoint, endpoint)))
	);
	return Boolean(row);
}

/**
 * To every phone of these people of the family. Never fails: a notice that does not arrive is said
 * in the log, and a subscription the push service no longer knows (the app uninstalled, the
 * permission taken back) is forgotten.
 */
export async function notify(familyId: string, userIds: string[], message: PushMessage) {
	if (!userIds.length) return;
	try {
		const { publicKey, privateKey } = await vapidKeys();
		const subscriptions = await asFamily(familyId, (tx) =>
			tx.select().from(pushSubscription).where(inArray(pushSubscription.userId, userIds))
		);
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
						await asFamily(familyId, (tx) =>
							tx.delete(pushSubscription).where(eq(pushSubscription.id, s.id))
						);
						console.info('[avisos] Un móvil ya no recibe avisos: olvidado', { userId: s.userId });
					} else console.warn('[avisos] No se pudo mandar un aviso', { userId: s.userId, error });
				}
			})
		);
	} catch (error) {
		console.error('[avisos] No se pudieron mandar los avisos', error);
	}
}
