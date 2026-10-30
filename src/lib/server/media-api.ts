import { hkdfSync, randomUUID } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { eq, sql } from 'drizzle-orm';
import { BETTER_AUTH_SECRET, MEDIA_HOST, ORIGIN } from '$app/env/private';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { episodeAllowed, isKid, KIDS_ROLE, seriesAllowed } from '#lib/server/kids.ts';
import { videoAllowed } from '#lib/server/kid-time.ts';
import {
	GRANT_HOURS,
	readGrant,
	readMusicPass,
	signGrant,
	signMusicPass,
	type MediaQuality
} from './media-token.ts';

/**
 * The video API for other apps (#253): the series, for the cloud's app, through the rathole tunnel
 * (MEDIA_HOST). The cloud comes with a key of its own (better-auth's api-key plugin, as the
 * satellites), made by the administrator in Ajustes → Casa and kept on the cloud's server, and
 * says in whose name it asks: the person's email, the same in both apps. A child of the cloud
 * (#303) too, for what it may watch and listen to (`cloudViewer`), as a child of the house. The
 * video itself, with signed links (media-token.ts).
 */

const KEY_HEADER = 'x-api-key';
const PERSON_HEADER = 'x-persona';
/** A child of the cloud (#303): its name, with its inner email (`@peques.invalid`) as `x-persona`. */
const KID_HEADER = 'x-peque';
export const KID_EMAIL = /@peques\.invalid$/;

/** Marked so in its key: not a satellite's (satellites.ts). */
interface CloudMetadata {
	cloud: true;
}

const isCloud = (metadata: unknown): metadata is CloudMetadata =>
	Boolean(metadata && typeof metadata === 'object' && 'cloud' in metadata);

/** Its own key, from BETTER_AUTH_SECRET (as secret-box.ts): changing that ends every link. */
const GRANT_KEY = Buffer.from(
	hkdfSync('sha256', BETTER_AUTH_SECRET, 'jellycartoon', 'media grant', 32)
);

/** Where the links point: the tunnel's name, or the app's own without one. */
const base = MEDIA_HOST ? `https://${MEDIA_HOST}` : ORIGIN;

/** A request of the cloud itself, in no one's name (its alarms, #253): a 401 without its key. */
export async function fromCloud(request: Request) {
	const key = request.headers.get(KEY_HEADER);
	if (!key) error(401, 'Falta la clave');
	const { valid, key: found } = await auth.api.verifyApiKey({ body: { key } });
	if (!valid || !found || !isCloud(found.metadata)) error(401, 'Clave no válida');
}

/**
 * The person a request of the cloud asks for: a 401 without a cloud key, a 403 if the person is
 * not an adult of the house.
 */
export async function cloudPerson(request: Request) {
	await fromCloud(request);
	const email = request.headers.get(PERSON_HEADER)?.trim().toLowerCase();
	if (!email) error(400, `Falta ${PERSON_HEADER}`);
	const [person] = await db
		.select({ id: user.id, name: user.name, role: user.role, banned: user.banned })
		.from(user)
		.where(eq(sql`lower(${user.email})`, email));
	if (!person || person.banned || isKid(person)) error(403, 'Nadie de la casa con ese email');
	return { id: person.id, name: person.name };
}

/**
 * A child of the cloud (#303), as one of the house's: its account here, made the first time, with
 * the role `infantil` and no way to sign in at home with it (no password); its name, the cloud's.
 */
export async function cloudKid(email: string, name: string) {
	const [found] = await db
		.select()
		.from(user)
		.where(eq(sql`lower(${user.email})`, email));
	if (found) {
		if (found.banned || !isKid(found)) error(403, 'Nadie de la casa con ese email');
		if (found.name === name) return found;
		const [renamed] = await db.update(user).set({ name }).where(eq(user.id, found.id)).returning();
		return renamed;
	}
	const now = new Date();
	const [made] = await db
		.insert(user)
		.values({
			id: randomUUID(),
			name,
			email,
			emailVerified: false,
			role: KIDS_ROLE,
			createdAt: now,
			updatedAt: now
		})
		.returning();
	return made;
}

/**
 * Who a request of the cloud asks for, to watch or listen: an adult, as `cloudPerson`, or a child
 * of the cloud (#303). A child is this request's user, so what the house filters for children
 * (kids.ts: only what is tagged «infantil») applies to it as at home.
 */
export async function cloudViewer(request: Request) {
	const kidName = request.headers.get(KID_HEADER);
	const email = request.headers.get(PERSON_HEADER)?.trim().toLowerCase();
	if (!kidName || !email || !KID_EMAIL.test(email))
		return { ...(await cloudPerson(request)), kid: false };
	await fromCloud(request);
	const kid = await cloudKid(email, decodeURIComponent(kidName).trim().slice(0, 60) || 'Peque');
	getRequestEvent().locals.user = kid;
	return { id: kid.id, name: kid.name, kid: true };
}

/** For a child (#303): only what is tagged for children, and only at its times (kid-time.ts). */
export async function kidMayWatch(viewer: { id: string; kid: boolean }, episodeId: number) {
	if (!viewer.kid) return;
	if (!(await episodeAllowed(episodeId))) error(404, 'Capítulo no encontrado');
	if (!(await videoAllowed(viewer.id)).allowed) error(403, 'Ahora no toca ver vídeos');
}

export async function kidMaySee(viewer: { kid: boolean }, seriesId: number) {
	if (viewer.kid && !(await seriesAllowed(seriesId))) error(404, 'Serie no encontrada');
}

/** A signed link to an episode's HLS, and where its progress goes. */
export function grantLinks(userId: string, episodeId: number, quality: MediaQuality) {
	const expires = Date.now() + GRANT_HOURS * 3_600_000;
	const token = signGrant(GRANT_KEY, { userId, episodeId, quality, expires });
	return {
		url: `${base}/api/v1/hls/${token}/master.m3u8`,
		progressUrl: `${base}/api/v1/progreso/${token}`,
		expires: new Date(expires).toISOString()
	};
}

/**
 * A music pass (media-token.ts): where its tracks and covers are, for the cloud's page to make
 * their links (`${base}/pistas/<id>`, `${base}/portadas/<album id>`).
 */
export function musicPassLinks(userId: string) {
	const expires = Date.now() + GRANT_HOURS * 3_600_000;
	const token = signMusicPass(GRANT_KEY, { userId, expires });
	return {
		base: `${base}/api/v1/musica/${token}`,
		/** The same pass for the episodes' thumbnails and the series' backgrounds. */
		images: `${base}/api/v1/imagenes/${token}`,
		expires: new Date(expires).toISOString()
	};
}

/** The pass in a link, or a 403: wrong, or expired (the cloud asks for a new one). */
export function musicPassOf(token: string) {
	const pass = readMusicPass(GRANT_KEY, token);
	if (!pass) error(403, 'Pase caducado o no válido');
	return pass;
}

/** The grant in a link, or a 403: wrong, or expired (the cloud asks for a new one). */
export function grantOf(token: string) {
	const grant = readGrant(GRANT_KEY, token);
	if (!grant) error(403, 'Enlace caducado o no válido');
	return grant;
}

/**
 * Anyone may read them, with the link: they are opened by the cloud's pages, from another
 * domain, and no cookie goes with them (CORS only guards what the browser sends on its own).
 */
export const CORS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Content-Type, Range',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Expose-Headers': 'Content-Length, Content-Range'
};

export function withCors(response: Response) {
	for (const [name, value] of Object.entries(CORS)) response.headers.set(name, value);
	return response;
}

/** The cloud's keys of this adult, for Ajustes: never the keys, only how they start. */
export async function listCloudKeys(headers: Headers) {
	const { apiKeys } = await auth.api.listApiKeys({ headers });
	return apiKeys
		.filter((k) => isCloud(k.metadata))
		.map((k) => ({
			id: k.id,
			name: k.name ?? 'Seilide',
			start: k.start,
			createdAt: k.createdAt,
			lastRequest: k.lastRequest
		}));
}

/** A new one: the key, shown once. */
export async function createCloudKey(name: string, headers: Headers) {
	const metadata: CloudMetadata = { cloud: true };
	const created = await auth.api.createApiKey({ body: { name, metadata }, headers });
	return created.key;
}

export async function deleteCloudKey(id: string, headers: Headers) {
	await auth.api.deleteApiKey({ body: { keyId: id }, headers });
}
