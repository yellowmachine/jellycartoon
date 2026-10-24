import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, count, eq, gt } from 'drizzle-orm';
import QRCode from 'qrcode';
import { ORIGIN } from '$app/env/private';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { trustedDevice, tvLoginRequest, user } from '#lib/server/db/schema.ts';
import { houseAdults } from '#lib/server/people.ts';
import { notify } from '#lib/server/push.ts';
import { takeSignInLink } from '#lib/server/sign-in-links.ts';
import { log } from '#lib/server/log.ts';
import type { RequestState } from '#lib/server/kid-login.ts';

/**
 * Adults entering on a device of the house from their phone (#172), as in Steam: in «¿Quién eres?»
 * they choose their drawing, the device shows a QR and their phone gets a notice, and on the phone
 * (signed in, so past their password and second step) they say yes. Then the device enters as
 * them, with a session of its own: Better Auth's magic link, made and spent by the server in the
 * device's request, which sets its cookie. Only that person can say yes, and the phone says where.
 */

/** A phone to unlock and a camera to open: more than a child's two minutes. */
const REQUEST_MS = 3 * 60_000;
/** Requests a device may make in a minute. */
const REQUESTS_PER_MINUTE = 3;

const hash = (code: string) => createHash('sha256').update(code).digest('hex');

/** The adults shown in «¿Quién eres?»: those who have entered (and so can say yes on a phone). */
export async function pickableAdults() {
	return (await houseAdults())
		.filter((a) => a.hasPassword)
		.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar }));
}

/** The device's page, waiting for the answer. */
const listeners = new Map<string, Set<(state: RequestState) => void>>();

function tell(requestId: string, state: RequestState) {
	for (const listener of listeners.get(requestId) ?? []) listener(state);
}

export function watchAdultRequest(requestId: string, listener: (state: RequestState) => void) {
	let set = listeners.get(requestId);
	if (!set) listeners.set(requestId, (set = new Set()));
	set.add(listener);
	return () => {
		set.delete(listener);
		if (!set.size) listeners.delete(requestId);
	};
}

/** A request as it is now: expired once its time has passed unanswered. */
export async function adultRequestState(requestId: string, deviceId: number) {
	const [row] = await db
		.select({ state: tvLoginRequest.state, expiresAt: tvLoginRequest.expiresAt })
		.from(tvLoginRequest)
		.where(and(eq(tvLoginRequest.id, requestId), eq(tvLoginRequest.deviceId, deviceId)));
	if (!row) return null;
	return row.state === 'pending' && row.expiresAt <= new Date() ? 'expired' : row.state;
}

/**
 * An adult chose their drawing on this device: a code only they can approve, as a QR on the
 * device and a notice on their phone.
 */
export async function askAsAdult(userId: string, device: { id: number; name: string }) {
	if (!(await pickableAdults()).some((a) => a.id === userId))
		return { error: 'Esta persona todavía no ha entrado en la app' };
	const [recent] = await db
		.select({ n: count() })
		.from(tvLoginRequest)
		.where(
			and(
				eq(tvLoginRequest.deviceId, device.id),
				gt(tvLoginRequest.createdAt, new Date(Date.now() - 60_000))
			)
		);
	if ((recent?.n ?? 0) >= REQUESTS_PER_MINUTE)
		return { error: 'Espera un poco antes de volver a pedirlo' };
	const id = randomUUID();
	const code = randomBytes(18).toString('base64url');
	await db.insert(tvLoginRequest).values({
		id,
		userId,
		deviceId: device.id,
		codeHash: hash(code),
		expiresAt: new Date(Date.now() + REQUEST_MS)
	});
	setTimeout(() => tell(id, 'expired'), REQUEST_MS + 500).unref?.();
	const url = `${ORIGIN}/entrar?codigo=${code}`;
	// With the app closed too. Touched, it opens the page where they say yes.
	void notify([userId], {
		title: `Entrar en ${device.name}`,
		body: 'Toca para entrar con tu cuenta.',
		tag: `tele-${device.id}`,
		url: `/entrar?codigo=${code}`,
		ttl: REQUEST_MS / 1000,
		sticky: true
	});
	log.info('cuentas', `Pide entrar en ${device.name}`, {
		userId,
		deviceId: device.id,
		requestId: id
	});
	return { requestId: id, qr: await QRCode.toString(url, { type: 'svg', margin: 1 }) };
}

/** What the phone shows for a code: who it is for, and where. */
export async function requestByCode(code: string) {
	const [row] = await db
		.select({
			id: tvLoginRequest.id,
			userId: tvLoginRequest.userId,
			name: user.name,
			device: trustedDevice.name,
			state: tvLoginRequest.state,
			expiresAt: tvLoginRequest.expiresAt
		})
		.from(tvLoginRequest)
		.innerJoin(user, eq(user.id, tvLoginRequest.userId))
		.innerJoin(trustedDevice, eq(trustedDevice.id, tvLoginRequest.deviceId))
		.where(eq(tvLoginRequest.codeHash, hash(code)));
	if (!row || row.state !== 'pending' || row.expiresAt <= new Date()) return null;
	return row;
}

/** The person's answer, from their phone: only they can give it. */
export async function answer(code: string, adultId: string, yes: boolean) {
	const row = await requestByCode(code);
	if (!row) return 'late' as const;
	if (row.userId !== adultId) return 'not-yours' as const;
	const state = yes ? 'approved' : 'denied';
	const [updated] = await db
		.update(tvLoginRequest)
		.set({ state })
		.where(and(eq(tvLoginRequest.id, row.id), eq(tvLoginRequest.state, 'pending')))
		.returning({ id: tvLoginRequest.id });
	if (!updated) return 'late' as const;
	log.info('cuentas', yes ? `Entra en ${row.device}` : `No entra en ${row.device}`, {
		userId: adultId,
		requestId: row.id
	});
	tell(row.id, state);
	return state;
}

/**
 * The device, in as that person: its request was approved, and is used up now. The magic link is
 * made and verified here, in the device's request, so Better Auth sets the session's cookie on it.
 */
export async function enterAsAdult(device: { id: number }, requestId: string, headers: Headers) {
	const [used] = await db
		.update(tvLoginRequest)
		.set({ state: 'used' })
		.where(
			and(
				eq(tvLoginRequest.id, requestId),
				eq(tvLoginRequest.deviceId, device.id),
				eq(tvLoginRequest.state, 'approved')
			)
		)
		.returning({ userId: tvLoginRequest.userId });
	if (!used) return false;
	const [person] = await db
		.select({ email: user.email, emailVerified: user.emailVerified })
		.from(user)
		.where(eq(user.id, used.userId));
	// An unverified account's password would be taken away by the magic link: never, here.
	if (!person?.emailVerified) {
		log.error('cuentas', 'Email sin verificar: no se entra por el móvil', { userId: used.userId });
		return false;
	}
	await auth.api.signInMagicLink({ body: { email: person.email }, headers });
	const token = takeSignInLink(person.email);
	if (!token) return false;
	await auth.api.magicLinkVerify({ query: { token }, headers });
	return true;
}
