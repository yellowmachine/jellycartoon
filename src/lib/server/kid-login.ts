import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { and, asc, count, eq, gt, inArray, sql } from 'drizzle-orm';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import {
	kidGuardian,
	kidLoginRequest,
	kidPermit,
	kidProfile,
	session,
	trustedDevice,
	user
} from '#lib/server/db/schema.ts';
import { isAdmin } from '#lib/server/app-settings.ts';
import { KIDS_ROLE } from '#lib/server/kids.ts';
import { log } from '#lib/server/log.ts';
import { decrypt, encrypt } from '#lib/server/secret-box.ts';
import { notify } from '#lib/server/push.ts';
import { addCompanions, togetherOf } from '#lib/server/watching-together.ts';
import { avatar, type PermitId } from 'comun/avatars.ts';

/**
 * Children who enter with a parent's permission (#141). On a trusted device (the living room's
 * TV) a child chooses its avatar; one of its parents or guardians is asked, and says yes (for this
 * time, a while, or the day) or no. Then the server signs the child in with its credential, which
 * only the server knows: Better Auth's own sign-in, so the session is like any other, marked
 * `kidApproved` and ending when the permission does.
 */

/** Unanswered by then, it is no longer asked: the child has gone on to something else. */
const REQUEST_MS = 2 * 60_000;
/** Requests a device may make in a minute: a child pressing again and again asks a few times. */
const REQUESTS_PER_MINUTE = 3;
const DEVICE_COOKIE = 'jellycartoon-dispositivo';
/** As long as a device is the house's; an adult can take it back in Ajustes. */
const DEVICE_COOKIE_DAYS = 5 * 365;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** In Ajustes: what each child is (avatar, with permission or password) and who lets it in. */
export async function kidProfiles() {
	const kids = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			avatar: kidProfile.avatar,
			byApproval: kidProfile.byApproval
		})
		.from(user)
		.leftJoin(kidProfile, eq(kidProfile.userId, user.id))
		.where(eq(user.role, KIDS_ROLE))
		.orderBy(asc(user.name));
	const guardians = kids.length
		? await db
				.select()
				.from(kidGuardian)
				.where(
					inArray(
						kidGuardian.kidId,
						kids.map((k) => k.id)
					)
				)
		: [];
	return kids.map((k) => ({
		...k,
		avatar: avatar(k.avatar).id,
		byApproval: k.byApproval ?? false,
		guardians: guardians.filter((g) => g.kidId === k.id).map((g) => g.guardianId)
	}));
}

/** The adults who can be a child's parents or guardians. */
export async function adults() {
	return db
		.select({ id: user.id, name: user.name })
		.from(user)
		.where(sql`${user.role} is distinct from ${KIDS_ROLE}`)
		.orderBy(asc(user.name));
}

/**
 * A child's avatar, whether it enters with permission, and who gives it. With permission, a new
 * credential that only the server knows (the password it had stops working, and its open sessions
 * end); without it, the password the adult typed. `headers`: the administrator's request, as
 * Better Auth's admin API asks for.
 */
export async function saveKid(
	kidId: string,
	options: { avatar: string; byApproval: boolean; guardians: string[]; password?: string },
	headers: Headers
) {
	const [before] = await db.select().from(kidProfile).where(eq(kidProfile.userId, kidId));
	let secret = before?.secret ?? null;
	if (options.byApproval && (!before?.byApproval || !secret || !decrypt(secret))) {
		const credential = randomBytes(32).toString('base64url');
		await auth.api.setUserPassword({ body: { userId: kidId, newPassword: credential }, headers });
		await auth.api.revokeUserSessions({ body: { userId: kidId }, headers });
		secret = encrypt(credential);
	} else if (!options.byApproval) {
		if (before?.byApproval) {
			if (!options.password) throw new Error('Para entrar con contraseña, escribe una');
			await auth.api.revokeUserSessions({ body: { userId: kidId }, headers });
		}
		if (options.password)
			await auth.api.setUserPassword({
				body: { userId: kidId, newPassword: options.password },
				headers
			});
		secret = null;
	}
	const adultIds = new Set((await adults()).map((a) => a.id));
	await db.transaction(async (tx) => {
		const row = { avatar: options.avatar, byApproval: options.byApproval, secret };
		await tx
			.insert(kidProfile)
			.values({ userId: kidId, ...row })
			.onConflictDoUpdate({ target: kidProfile.userId, set: row });
		await tx.delete(kidGuardian).where(eq(kidGuardian.kidId, kidId));
		const guardians = options.guardians.filter((g) => adultIds.has(g));
		if (guardians.length)
			await tx.insert(kidGuardian).values(guardians.map((guardianId) => ({ kidId, guardianId })));
	});
	byApprovalCache.delete(kidId);
}

/** Whether each child enters with permission; changed only by saveKid. */
const byApprovalCache = new Map<string, boolean>();

export async function entersByApproval(kidId: string) {
	let value = byApprovalCache.get(kidId);
	if (value === undefined) {
		const [row] = await db
			.select({ byApproval: kidProfile.byApproval })
			.from(kidProfile)
			.where(eq(kidProfile.userId, kidId));
		value = row?.byApproval ?? false;
		byApprovalCache.set(kidId, value);
	}
	return value;
}

// Devices.

/** This device as the house's: from now on it shows «¿Quién eres?». */
export async function trustDevice(cookies: Cookies, name: string, adultId: string) {
	const token = randomBytes(32).toString('base64url');
	await db.insert(trustedDevice).values({ tokenHash: hash(token), name, createdBy: adultId });
	cookies.set(DEVICE_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: DEVICE_COOKIE_DAYS * 86_400
	});
	log.info('peques', `Dispositivo de confianza: ${name}`, { by: adultId });
}

/** The trusted device this request comes from, if it is one. */
export async function deviceOf(cookies: Cookies) {
	const token = cookies.get(DEVICE_COOKIE);
	if (!token) return null;
	const [device] = await db
		.update(trustedDevice)
		.set({ lastSeenAt: new Date() })
		.where(eq(trustedDevice.tokenHash, hash(token)))
		.returning({ id: trustedDevice.id, name: trustedDevice.name });
	return device ?? null;
}

export async function trustedDevices() {
	return db
		.select({
			id: trustedDevice.id,
			name: trustedDevice.name,
			createdAt: trustedDevice.createdAt,
			lastSeenAt: trustedDevice.lastSeenAt
		})
		.from(trustedDevice)
		.orderBy(asc(trustedDevice.name));
}

/** No longer the house's: its requests and permissions go with it. */
export async function forgetDevice(id: number) {
	await db.delete(trustedDevice).where(eq(trustedDevice.id, id));
	log.info('peques', 'Dispositivo de confianza quitado', { deviceId: id });
}

// Requests.

export type RequestState = 'pending' | 'approved' | 'denied' | 'expired' | 'used';

/** The children shown in «¿Quién eres?»: those who enter with permission. */
export async function pickableKids() {
	const rows = await db
		.select({ id: user.id, name: user.name, avatar: kidProfile.avatar })
		.from(kidProfile)
		.innerJoin(user, eq(user.id, kidProfile.userId))
		.where(and(eq(kidProfile.byApproval, true), eq(user.role, KIDS_ROLE)))
		.orderBy(asc(user.name));
	return rows.map((r) => ({ ...r, avatar: avatar(r.avatar).id }));
}

/** Who is told when a child asks: its parents or guardians; with none, the administrator. */
async function guardiansOf(kidId: string) {
	const rows = await db
		.select({ id: kidGuardian.guardianId })
		.from(kidGuardian)
		.where(eq(kidGuardian.kidId, kidId));
	if (rows.length) return rows.map((r) => r.id);
	const [first] = await db.select({ id: user.id }).from(user).orderBy(asc(user.createdAt)).limit(1);
	return first ? [first.id] : [];
}

/** Whether this adult may let this child in (or add it to watch with others, #160). */
export async function mayDecide(adultId: string, kidId: string) {
	return (await guardiansOf(kidId)).includes(adultId);
}

/** Pages waiting for an answer: the device's, by request, and the parents', by adult. */
const deviceListeners = new Map<string, Set<(state: RequestState) => void>>();
const guardianListeners = new Map<string, Set<() => void>>();

function tellDevice(requestId: string, state: RequestState) {
	for (const listener of deviceListeners.get(requestId) ?? []) listener(state);
}

async function tellGuardians(kidId: string) {
	for (const id of await guardiansOf(kidId))
		for (const listener of guardianListeners.get(id) ?? []) listener();
}

/** The device's page, told when its request is answered (or expires). */
export function watchRequest(requestId: string, listener: (state: RequestState) => void) {
	let listeners = deviceListeners.get(requestId);
	if (!listeners) deviceListeners.set(requestId, (listeners = new Set()));
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (!listeners.size) deviceListeners.delete(requestId);
	};
}

/** A parent's pages, told when one of its children asks or is answered. */
export function watchRequestsFor(adultId: string, listener: () => void) {
	let listeners = guardianListeners.get(adultId);
	if (!listeners) guardianListeners.set(adultId, (listeners = new Set()));
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (!listeners.size) guardianListeners.delete(adultId);
	};
}

/** A request as it is now: expired once its time has passed unanswered. */
export async function requestState(requestId: string, deviceId: number) {
	const [row] = await db
		.select()
		.from(kidLoginRequest)
		.where(and(eq(kidLoginRequest.id, requestId), eq(kidLoginRequest.deviceId, deviceId)));
	if (!row) return null;
	const state: RequestState =
		row.state === 'pending' && row.expiresAt <= new Date() ? 'expired' : row.state;
	return { ...row, state };
}

/**
 * A child asks to enter from this device. With a permission still running there (`kidPermit`),
 * it enters without asking: `permit`. Otherwise its parents are told, and the page waits.
 */
export async function askToEnter(kidId: string, device: { id: number; name: string }) {
	if (!(await entersByApproval(kidId))) return { error: 'Esta cuenta entra con contraseña' };
	const [permit] = await db
		.select({ until: kidPermit.until })
		.from(kidPermit)
		.where(
			and(
				eq(kidPermit.kidId, kidId),
				eq(kidPermit.deviceId, device.id),
				gt(kidPermit.until, new Date())
			)
		);
	if (permit) return { permit: true as const };
	const [recent] = await db
		.select({ n: count() })
		.from(kidLoginRequest)
		.where(
			and(
				eq(kidLoginRequest.deviceId, device.id),
				gt(kidLoginRequest.createdAt, new Date(Date.now() - 60_000))
			)
		);
	if ((recent?.n ?? 0) >= REQUESTS_PER_MINUTE)
		return { error: 'Espera un poquito antes de volver a pedirlo' };
	const id = randomUUID();
	const expiresAt = new Date(Date.now() + REQUEST_MS);
	await db.insert(kidLoginRequest).values({ id, kidId, deviceId: device.id, expiresAt });
	// When it expires, the device's page and the parents' know it at once.
	setTimeout(() => {
		tellDevice(id, 'expired');
		void tellGuardians(kidId);
	}, REQUEST_MS + 500).unref?.();
	void tellGuardians(kidId);
	// With the app closed too: on their phones. Touched, it opens the app, where they answer.
	void guardiansOf(kidId).then(async (ids) => {
		const [kid] = await db.select({ name: user.name }).from(user).where(eq(user.id, kidId));
		await notify(ids, {
			title: `${kid?.name ?? 'Un peque'} quiere entrar`,
			body: `En ${device.name}. Toca para contestar.`,
			tag: `peque-${kidId}`,
			url: '/',
			ttl: REQUEST_MS / 1000,
			// Until it is touched or dismissed: someone is waiting in front of the TV.
			sticky: true
		});
	});
	log.info('peques', `Pide entrar en ${device.name}`, {
		kidId,
		deviceId: device.id,
		requestId: id
	});
	return { requestId: id };
}

/** What a parent sees to answer: its children's requests still waiting. */
export async function pendingFor(adultId: string) {
	const rows = await db
		.select({
			id: kidLoginRequest.id,
			kidId: kidLoginRequest.kidId,
			name: user.name,
			avatar: kidProfile.avatar,
			device: trustedDevice.name,
			createdAt: kidLoginRequest.createdAt,
			expiresAt: kidLoginRequest.expiresAt
		})
		.from(kidLoginRequest)
		.innerJoin(user, eq(user.id, kidLoginRequest.kidId))
		.innerJoin(trustedDevice, eq(trustedDevice.id, kidLoginRequest.deviceId))
		.leftJoin(kidProfile, eq(kidProfile.userId, kidLoginRequest.kidId))
		.where(and(eq(kidLoginRequest.state, 'pending'), gt(kidLoginRequest.expiresAt, new Date())))
		.orderBy(asc(kidLoginRequest.createdAt));
	const mine: typeof rows = [];
	for (const row of rows) if (await mayDecide(adultId, row.kidId)) mine.push(row);
	// The others who could watch with it (#160), those this adult may let in.
	const together = await togetherOf(mine.map((r) => r.kidId));
	return Promise.all(
		mine.map(async (r) => {
			const others = together.find((t) => t.kidId === r.kidId)?.available ?? [];
			const allowed = [];
			for (const kid of others) if (await mayDecide(adultId, kid.id)) allowed.push(kid);
			return { ...r, avatar: avatar(r.avatar).id, available: allowed };
		})
	);
}

/** Whether this adult lets in any child who enters with permission (its pages listen for them). */
export async function isGuardian(adultId: string) {
	const [row] = await db
		.select({ one: sql`1` })
		.from(kidGuardian)
		.innerJoin(kidProfile, eq(kidProfile.userId, kidGuardian.kidId))
		.where(and(eq(kidGuardian.guardianId, adultId), eq(kidProfile.byApproval, true)))
		.limit(1);
	if (row) return true;
	// The administrator answers for the children with nobody else.
	if (!(await isAdmin(adultId))) return false;
	const [orphan] = await db
		.select({ one: sql`1` })
		.from(kidProfile)
		.where(
			and(
				eq(kidProfile.byApproval, true),
				sql`not exists (select 1 from ${kidGuardian} where ${kidGuardian.kidId} = ${kidProfile.userId})`
			)
		)
		.limit(1);
	return Boolean(orphan);
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
 * A parent's answer. Yes, for this time (the session ends at night or when it leaves) or for a
 * while, in which it enters on that device again without asking; or no.
 */
export async function decide(
	requestId: string,
	adultId: string,
	answer: PermitId | 'no',
	/** The other children let in with it, to watch together (#160). */
	companions: string[] = []
) {
	const [row] = await db.select().from(kidLoginRequest).where(eq(kidLoginRequest.id, requestId));
	if (!row || !(await mayDecide(adultId, row.kidId))) return 'not-found' as const;
	if (row.state !== 'pending' || row.expiresAt <= new Date()) return 'late' as const;
	const until = answer === 'no' ? null : permitEnd(answer);
	const together: string[] = [];
	if (until)
		for (const id of new Set(companions))
			if (id !== row.kidId && (await mayDecide(adultId, id))) together.push(id);
	const [updated] = await db
		.update(kidLoginRequest)
		.set({
			state: until ? 'approved' : 'denied',
			decidedBy: adultId,
			until,
			companions: together
		})
		.where(and(eq(kidLoginRequest.id, requestId), eq(kidLoginRequest.state, 'pending')))
		.returning({ id: kidLoginRequest.id });
	// Another parent answered first.
	if (!updated) return 'late' as const;
	if (until && answer !== 'once')
		await db
			.insert(kidPermit)
			.values({ kidId: row.kidId, deviceId: row.deviceId, until, grantedBy: adultId })
			.onConflictDoUpdate({
				target: [kidPermit.kidId, kidPermit.deviceId],
				set: { until, grantedBy: adultId }
			});
	log.info('peques', until ? `Le dejan entrar (${answer})` : 'No le dejan entrar', {
		kidId: row.kidId,
		deviceId: row.deviceId,
		by: adultId,
		until
	});
	tellDevice(requestId, until ? 'approved' : 'denied');
	void tellGuardians(row.kidId);
	return until ? ('approved' as const) : ('denied' as const);
}

/**
 * The child, signed in on this device: its request was approved (and is used up now), or it has a
 * permission running there. Better Auth's own sign-in with its credential sets the session's
 * cookie on this request; the session is then marked as let in, and ends with the permission.
 */
export async function enter(
	device: { id: number; name: string },
	by: { requestId: string } | { kidId: string }
) {
	let kidId: string;
	let until: Date;
	let together: { ids: string[]; by: string } | null = null;
	if ('requestId' in by) {
		const [used] = await db
			.update(kidLoginRequest)
			.set({ state: 'used' })
			.where(
				and(
					eq(kidLoginRequest.id, by.requestId),
					eq(kidLoginRequest.deviceId, device.id),
					eq(kidLoginRequest.state, 'approved')
				)
			)
			.returning({
				kidId: kidLoginRequest.kidId,
				until: kidLoginRequest.until,
				companions: kidLoginRequest.companions,
				decidedBy: kidLoginRequest.decidedBy
			});
		if (!used?.until || used.until <= new Date()) return null;
		({ kidId, until } = { kidId: used.kidId, until: used.until });
		if (used.companions.length && used.decidedBy)
			together = { ids: used.companions, by: used.decidedBy };
	} else {
		const [permit] = await db
			.select({ until: kidPermit.until })
			.from(kidPermit)
			.where(
				and(
					eq(kidPermit.kidId, by.kidId),
					eq(kidPermit.deviceId, device.id),
					gt(kidPermit.until, new Date())
				)
			);
		if (!permit) return null;
		({ kidId, until } = { kidId: by.kidId, until: permit.until });
	}
	const [kid] = await db
		.select({ email: user.email, secret: kidProfile.secret, byApproval: kidProfile.byApproval })
		.from(kidProfile)
		.innerJoin(user, eq(user.id, kidProfile.userId))
		.where(eq(kidProfile.userId, kidId));
	const credential = kid?.byApproval && kid.secret ? decrypt(kid.secret) : null;
	if (!kid || !credential) {
		log.error('peques', 'No se pudo usar la credencial del peque: guárdalo otra vez en Ajustes', {
			kidId
		});
		return null;
	}
	const result = await auth.api.signInEmail({
		body: { email: kid.email, password: credential, rememberMe: false }
	});
	const [signedIn] = await db
		.update(session)
		.set({ kidApproved: true, expiresAt: until })
		.where(eq(session.token, result.token))
		.returning({ id: session.id });
	if (together && signedIn)
		await addCompanions(kidId, together.ids, together.by, signedIn.id).catch((error) =>
			log.warn('peques', 'No se pudieron añadir los que ven juntos', { kidId, error })
		);
	log.info('peques', `Entra en ${device.name}`, { kidId, deviceId: device.id, until });
	return { kidId, until };
}
