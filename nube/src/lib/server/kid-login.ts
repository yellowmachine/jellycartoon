import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { and, asc, count, eq, gt } from 'drizzle-orm';
import { avatar, type PermitId } from 'comun/avatars.ts';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import {
	familyMember,
	familyPerson,
	kidAccount,
	kidGuardian,
	kidLoginRequest,
	kidPermit,
	session,
	trustedDevice,
	user
} from '#lib/server/db/schema.ts';
import { asFamily } from '#lib/server/family.ts';
import type { Kitchen } from '#lib/server/fridge.ts';
import { notify } from '#lib/server/push.ts';
import { decrypt } from '#lib/server/secret-box.ts';

/**
 * Children who enter with an adult's permission (#303), as at home (jellycartoon's #141). On a
 * device its administrator marked as the family's, a child chooses its drawing; its adults are
 * told on their phones and say yes (this time, a while, or the day) or no. Then the server signs
 * it in with its credential (kids.ts), Better Auth's own sign-in, and its session ends when the
 * permission does. An adult can also hand their own phone to one of their children.
 */

/** Unanswered by then, it is no longer asked: the child has gone on to something else. */
const REQUEST_MS = 2 * 60_000;
/** Requests a device may make in a minute: a child pressing again and again asks a few times. */
const REQUESTS_PER_MINUTE = 3;
const DEVICE_COOKIE = 'seilide-peques';
/** As long as it is the family's; its administrator can take it back in Ajustes. */
const DEVICE_COOKIE_DAYS = 5 * 365;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface Device {
	id: number;
	familyId: string;
	name: string;
}

// ——— Devices ———

/** This device as the family's: from now on, «¿Quién eres?» on entering. */
export async function trustDevice(k: Kitchen, cookies: Cookies, name: string) {
	const token = randomBytes(32).toString('base64url');
	await k.run((tx) =>
		tx
			.insert(trustedDevice)
			.values({ familyId: k.familyId, tokenHash: hash(token), name, createdBy: k.userId })
	);
	// Its family in the cookie: before anyone has entered there is no other way to know it.
	cookies.set(DEVICE_COOKIE, `${k.familyId}.${token}`, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: DEVICE_COOKIE_DAYS * 86_400
	});
}

/** The family's device this request comes from, if it is one. */
export async function deviceOf(cookies: Cookies): Promise<Device | null> {
	const value = cookies.get(DEVICE_COOKIE);
	const dot = value?.indexOf('.') ?? -1;
	if (!value || dot < 1) return null;
	const familyId = value.slice(0, dot);
	const [device] = await asFamily(familyId, (tx) =>
		tx
			.update(trustedDevice)
			.set({ lastSeenAt: new Date() })
			.where(eq(trustedDevice.tokenHash, hash(value.slice(dot + 1))))
			.returning({ id: trustedDevice.id, name: trustedDevice.name })
	);
	return device ? { ...device, familyId } : null;
}

export function trustedDevices(k: Kitchen) {
	return k.run((tx) =>
		tx
			.select({
				id: trustedDevice.id,
				name: trustedDevice.name,
				createdAt: trustedDevice.createdAt,
				lastSeenAt: trustedDevice.lastSeenAt
			})
			.from(trustedDevice)
			.orderBy(asc(trustedDevice.name))
	);
}

/** No longer the family's: its requests and permissions go with it. */
export async function forgetDevice(k: Kitchen, id: number) {
	await k.run((tx) => tx.delete(trustedDevice).where(eq(trustedDevice.id, id)));
}

/** That device's cookie gone from this browser (and the device, if it is this one). */
export async function untrustThisDevice(k: Kitchen, cookies: Cookies) {
	const device = await deviceOf(cookies);
	if (device?.familyId === k.familyId) await forgetDevice(k, device.id);
	cookies.delete(DEVICE_COOKIE, { path: '/' });
}

// ——— Who asks, who answers ———

/** The family's children with an account, as «¿Quién eres?» shows them. */
export async function pickableKids(familyId: string) {
	const rows = await asFamily(familyId, (tx) =>
		tx
			.select({ id: user.id, name: user.name, avatar: familyPerson.avatar })
			.from(familyMember)
			.innerJoin(user, eq(user.id, familyMember.userId))
			.innerJoin(familyPerson, eq(familyPerson.userId, familyMember.userId))
			.where(eq(familyMember.role, 'peque'))
			.orderBy(asc(user.name))
	);
	return rows.map((r) => ({ ...r, avatar: avatar(r.avatar).id }));
}

/** Who is told when a child asks: its adults; with none, the family's administrators. */
async function guardiansOf(familyId: string, kidId: string) {
	return asFamily(familyId, async (tx) => {
		const rows = await tx
			.select({ id: kidGuardian.guardianId })
			.from(kidGuardian)
			.where(eq(kidGuardian.kidId, kidId));
		if (rows.length) return rows.map((r) => r.id);
		const admins = await tx
			.select({ id: familyMember.userId })
			.from(familyMember)
			.where(eq(familyMember.role, 'admin'));
		return admins.map((a) => a.id);
	});
}

/** Whether this adult may let this child in (or hand it their phone). */
export async function mayDecide(familyId: string, adultId: string, kidId: string) {
	return (await guardiansOf(familyId, kidId)).includes(adultId);
}

/** The children this adult lets in: for «Pasar a…» on their phone. */
export async function kidsOf(k: Kitchen) {
	const kids = await pickableKids(k.familyId);
	const mine = [];
	for (const kid of kids) if (await mayDecide(k.familyId, k.userId!, kid.id)) mine.push(kid);
	return mine;
}

// ——— Live answers ———

export type RequestState = 'pending' | 'approved' | 'denied' | 'expired' | 'used';

/** Pages waiting for an answer: the device's, by request, and the adults', by adult. */
const deviceListeners = new Map<string, Set<(state: RequestState) => void>>();
const guardianListeners = new Map<string, Set<() => void>>();

function tellDevice(requestId: string, state: RequestState) {
	for (const listener of deviceListeners.get(requestId) ?? []) listener(state);
}

async function tellGuardians(familyId: string, kidId: string) {
	for (const id of await guardiansOf(familyId, kidId))
		for (const listener of guardianListeners.get(id) ?? []) listener();
}

function listen<T>(map: Map<string, Set<T>>, key: string, listener: T) {
	let listeners = map.get(key);
	if (!listeners) map.set(key, (listeners = new Set()));
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (!listeners.size) map.delete(key);
	};
}

/** The device's page, told when its request is answered (or expires). */
export const watchRequest = (requestId: string, listener: (state: RequestState) => void) =>
	listen(deviceListeners, requestId, listener);

/** An adult's pages, told when one of their children asks or is answered. */
export const watchRequestsFor = (adultId: string, listener: () => void) =>
	listen(guardianListeners, adultId, listener);

/** A request as it is now: expired once its time has passed unanswered. */
export async function requestState(device: Device, requestId: string) {
	const [row] = await asFamily(device.familyId, (tx) =>
		tx
			.select()
			.from(kidLoginRequest)
			.where(and(eq(kidLoginRequest.id, requestId), eq(kidLoginRequest.deviceId, device.id)))
	);
	if (!row) return null;
	const state: RequestState =
		row.state === 'pending' && row.expiresAt <= new Date() ? 'expired' : row.state;
	return { ...row, state };
}

// ——— Asking ———

const isFamilyKid = async (familyId: string, kidId: string) =>
	(await pickableKids(familyId)).some((kid) => kid.id === kidId);

/**
 * A child asks to enter from this device. With a permission still running there, it enters
 * without asking: `permit`. Otherwise its adults are told, and the page waits.
 */
export async function askToEnter(device: Device, kidId: string) {
	const { familyId } = device;
	if (!(await isFamilyKid(familyId, kidId))) return { error: 'No encontrado' };
	if (await permitOn(device, kidId)) return { permit: true as const };
	const [recent] = await asFamily(familyId, (tx) =>
		tx
			.select({ n: count() })
			.from(kidLoginRequest)
			.where(
				and(
					eq(kidLoginRequest.deviceId, device.id),
					gt(kidLoginRequest.createdAt, new Date(Date.now() - 60_000))
				)
			)
	);
	if ((recent?.n ?? 0) >= REQUESTS_PER_MINUTE)
		return { error: 'Espera un poquito antes de volver a pedirlo' };
	const id = randomUUID();
	const expiresAt = new Date(Date.now() + REQUEST_MS);
	await asFamily(familyId, (tx) =>
		tx.insert(kidLoginRequest).values({ id, familyId, kidId, deviceId: device.id, expiresAt })
	);
	// When it expires, the device's page and the adults' know it at once.
	setTimeout(() => {
		tellDevice(id, 'expired');
		void tellGuardians(familyId, kidId);
	}, REQUEST_MS + 500).unref?.();
	void tellGuardians(familyId, kidId);
	// With the app closed too: on their phones. Touched, it opens the app, where they answer.
	void (async () => {
		const [kid] = await db.select({ name: user.name }).from(user).where(eq(user.id, kidId));
		await notify(familyId, await guardiansOf(familyId, kidId), {
			title: `${kid?.name ?? 'Un peque'} quiere entrar`,
			body: `En ${device.name}. Toca para contestar.`,
			tag: `peque-${kidId}`,
			url: '/',
			ttl: REQUEST_MS / 1000,
			// Until it is touched or dismissed: someone is waiting in front of the screen.
			sticky: true
		});
	})().catch((err) => console.warn('[peques] Sin aviso a sus mayores', String(err)));
	return { requestId: id };
}

async function permitOn(device: Device, kidId: string) {
	const [permit] = await asFamily(device.familyId, (tx) =>
		tx
			.select({ until: kidPermit.until })
			.from(kidPermit)
			.where(
				and(
					eq(kidPermit.kidId, kidId),
					eq(kidPermit.deviceId, device.id),
					gt(kidPermit.until, new Date())
				)
			)
	);
	return permit?.until ?? null;
}

/** What an adult sees to answer: their children's requests still waiting. */
export async function pendingFor(k: Kitchen) {
	const rows = await k.run((tx) =>
		tx
			.select({
				id: kidLoginRequest.id,
				kidId: kidLoginRequest.kidId,
				name: user.name,
				avatar: familyPerson.avatar,
				device: trustedDevice.name
			})
			.from(kidLoginRequest)
			.innerJoin(user, eq(user.id, kidLoginRequest.kidId))
			.innerJoin(trustedDevice, eq(trustedDevice.id, kidLoginRequest.deviceId))
			.leftJoin(familyPerson, eq(familyPerson.userId, kidLoginRequest.kidId))
			.where(and(eq(kidLoginRequest.state, 'pending'), gt(kidLoginRequest.expiresAt, new Date())))
			.orderBy(asc(kidLoginRequest.createdAt))
	);
	const mine = [];
	for (const row of rows)
		if (await mayDecide(k.familyId, k.userId!, row.kidId))
			mine.push({ ...row, avatar: avatar(row.avatar).id });
	return mine;
}

/** Whether this adult lets any child in: their pages listen for them. */
export async function isGuardian(k: Kitchen) {
	return (await kidsOf(k)).length > 0;
}

/** When `permit` ends: in an hour, two, or at the end of the day («esta vez» too). */
function permitEnd(permit: PermitId) {
	if (permit === '1h' || permit === '2h')
		return new Date(Date.now() + (permit === '1h' ? 1 : 2) * 3600_000);
	const end = new Date();
	end.setHours(23, 59, 59, 999);
	return end;
}

/**
 * An adult's answer. Yes, for this time (the session ends at night or when it leaves) or for a
 * while, in which it enters on that device again without asking; or no.
 */
export async function decide(k: Kitchen, requestId: string, answer: PermitId | 'no') {
	const [row] = await k.run((tx) =>
		tx.select().from(kidLoginRequest).where(eq(kidLoginRequest.id, requestId))
	);
	if (!row || !(await mayDecide(k.familyId, k.userId!, row.kidId))) return 'not-found' as const;
	if (row.state !== 'pending' || row.expiresAt <= new Date()) return 'late' as const;
	const until = answer === 'no' ? null : permitEnd(answer);
	const [updated] = await k.run((tx) =>
		tx
			.update(kidLoginRequest)
			.set({ state: until ? 'approved' : 'denied', decidedBy: k.userId, until })
			.where(and(eq(kidLoginRequest.id, requestId), eq(kidLoginRequest.state, 'pending')))
			.returning({ id: kidLoginRequest.id })
	);
	// Another adult answered first.
	if (!updated) return 'late' as const;
	if (until && answer !== 'once')
		await k.run((tx) =>
			tx
				.insert(kidPermit)
				.values({
					familyId: k.familyId,
					kidId: row.kidId,
					deviceId: row.deviceId,
					until,
					grantedBy: k.userId
				})
				.onConflictDoUpdate({
					target: [kidPermit.kidId, kidPermit.deviceId],
					set: { until, grantedBy: k.userId }
				})
		);
	tellDevice(requestId, until ? 'approved' : 'denied');
	void tellGuardians(k.familyId, row.kidId);
	return until ? ('approved' as const) : ('denied' as const);
}

// ——— Entering ———

/**
 * The child, signed in on this browser with its credential: Better Auth's own sign-in, which sets
 * the session's cookie on this request; the session then ends when the permission does.
 */
async function signInAs(familyId: string, kidId: string, until: Date) {
	const [kid] = await asFamily(familyId, (tx) =>
		tx
			.select({ email: user.email, secret: kidAccount.secret })
			.from(kidAccount)
			.innerJoin(user, eq(user.id, kidAccount.userId))
			.where(eq(kidAccount.userId, kidId))
	);
	const credential = kid ? decrypt(kid.secret) : null;
	if (!kid || !credential) {
		console.error('[peques] Sin la credencial del peque: dale la cuenta otra vez', { kidId });
		return null;
	}
	const result = await auth.api.signInEmail({
		body: { email: kid.email, password: credential, rememberMe: false }
	});
	await db.update(session).set({ expiresAt: until }).where(eq(session.token, result.token));
	return { kidId, until };
}

/** On the family's device: with its request approved (used up now), or a permission running. */
export async function enter(device: Device, by: { requestId: string } | { kidId: string }) {
	if ('requestId' in by) {
		const [used] = await asFamily(device.familyId, (tx) =>
			tx
				.update(kidLoginRequest)
				.set({ state: 'used' })
				.where(
					and(
						eq(kidLoginRequest.id, by.requestId),
						eq(kidLoginRequest.deviceId, device.id),
						eq(kidLoginRequest.state, 'approved')
					)
				)
				.returning({ kidId: kidLoginRequest.kidId, until: kidLoginRequest.until })
		);
		if (!used?.until || used.until <= new Date()) return null;
		return signInAs(device.familyId, used.kidId, used.until);
	}
	const until = await permitOn(device, by.kidId);
	return until ? signInAs(device.familyId, by.kidId, until) : null;
}

/**
 * «Pasar a Lucía» (#303): an adult hands their own phone to one of their children, without asking
 * anyone (they are its adult). The adult's session ends here: to come back, they enter again.
 */
export async function handOver(k: Kitchen, kidId: string, permit: PermitId, headers: Headers) {
	if (!(await mayDecide(k.familyId, k.userId!, kidId))) return null;
	if (!(await isFamilyKid(k.familyId, kidId))) return null;
	await auth.api.signOut({ headers });
	return signInAs(k.familyId, kidId, permitEnd(permit));
}
