import { hkdfSync } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { BETTER_AUTH_SECRET, MEDIA_HOST, ORIGIN } from '$app/env/private';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { user } from '#lib/server/db/auth.schema.ts';
import { isKid } from '#lib/server/kids.ts';
import { GRANT_HOURS, signGrant, readGrant, type MediaQuality } from './media-token.ts';

/**
 * The video API for other apps (#253): the series, for the cloud's app, through the rathole tunnel
 * (MEDIA_HOST). The cloud comes with a key of its own (better-auth's api-key plugin, as the
 * satellites), made by the administrator in Ajustes → Casa and kept on the cloud's server, and
 * says in whose name it asks: the person's email, the same in both apps. For now only adults: the
 * children, later. The video itself, with signed links (media-token.ts).
 */

const KEY_HEADER = 'x-api-key';
const PERSON_HEADER = 'x-persona';

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

/**
 * The person a request of the cloud asks for: a 401 without a cloud key, a 403 if the person is
 * not an adult of the house.
 */
export async function cloudPerson(request: Request) {
	const key = request.headers.get(KEY_HEADER);
	if (!key) error(401, 'Falta la clave');
	const { valid, key: found } = await auth.api.verifyApiKey({ body: { key } });
	if (!valid || !found || !isCloud(found.metadata)) error(401, 'Clave no válida');
	const email = request.headers.get(PERSON_HEADER)?.trim().toLowerCase();
	if (!email) error(400, `Falta ${PERSON_HEADER}`);
	const [person] = await db
		.select({ id: user.id, name: user.name, role: user.role, banned: user.banned })
		.from(user)
		.where(eq(sql`lower(${user.email})`, email));
	if (!person || person.banned || isKid(person)) error(403, 'Nadie de la casa con ese email');
	return { id: person.id, name: person.name };
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
			name: k.name ?? 'Nube',
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
