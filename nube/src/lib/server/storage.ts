import {
	CopyObjectCommand,
	CreateBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	HeadBucketCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { error, isHttpError } from '@sveltejs/kit';
import { S3_ACCESS_KEY_ID, S3_BUCKET, S3_ENDPOINT, S3_SECRET_ACCESS_KEY } from '$app/env/private';
import { db } from './db/index.ts';
import { familyStorageScope } from './family-storage-scope.ts';
import { openFor } from './family-secret.ts';
import { fileQuota, fullText, warnAlmostFull, warnOwnStorage } from './file-quota.ts';
import { UNCOUNTED_AREAS, type StoredObject } from './file-quota-scope.ts';
import { bucketProblem, type Bucket, type Side } from './storage-bucket.ts';

/**
 * The families' files (#253): receipts' photos, bills, papers, walks' photos, voice notes… in an S3
 * storage, never served from it directly: the app gives them only to that family's people.
 *
 * Seilide's own (the stack's rustfs, compose.prod.yaml), each family under `familias/<id>/…`; the
 * bucket, made if it is not there. Or the family's own S3/R2 (#480, phase 2), in its folder
 * (`seilide/<area>/<name>`): where each family's are is `family_storage` (family-storage-scope.ts),
 * and while they move from one to the other, they are written in both and read from where they were
 * first (storage-move.ts copies them).
 *
 * What each file takes is kept in `stored_file` (file-quota.ts): in Seilide's storage, a family is
 * held to its quota, and a file that does not fit is refused with 507 and what to do. In its own,
 * there is no quota; only counted, to show it.
 */

const client =
	S3_ENDPOINT && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY
		? new S3Client({
				endpoint: S3_ENDPOINT,
				region: 'us-east-1',
				// rustfs, as MinIO: the bucket in the path, not in the host's name.
				forcePathStyle: true,
				credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
			})
		: null;

/** Whether there is a storage for files: without it, receipts are read but not kept. */
export const storageReady = Boolean(client);

/** Where each family's files are, and the moves (as the app's role). */
export const familyStorage = familyStorageScope(db);

let bucketReady: Promise<void> | null = null;

function storage() {
	if (!client) throw new Error('No hay almacenamiento de ficheros (S3_ENDPOINT)');
	bucketReady ??= client
		.send(new HeadBucketCommand({ Bucket: S3_BUCKET }))
		.then(() => undefined)
		.catch(async () => {
			await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
		})
		.catch((err) => {
			bucketReady = null;
			throw err;
		});
	return bucketReady.then(() => client);
}

/** Only plain names, never a path. */
function checkName(name: string) {
	if (!/^[\w.-]+$/.test(name) || name.startsWith('.'))
		throw new Error('Nombre de fichero no válido');
}

/** A storage a family's files are in: Seilide's, or its own. */
export interface Place {
	own: boolean;
	client: () => Promise<S3Client>;
	bucket: string;
	/** Where its files start: `familias/<id>/` or the family's folder. */
	root: string;
}

const seilidePlace = (familyId: string): Place => ({
	own: false,
	client: storage,
	bucket: S3_BUCKET,
	root: `familias/${familyId}/`
});

/** The family's own S3 client, one per bucket and keys. */
const ownClients = new Map<string, S3Client>();

export function ownPlace(b: Bucket): Place {
	const id = JSON.stringify(b);
	let s3 = ownClients.get(id);
	if (!s3) {
		s3 = new S3Client({
			endpoint: b.endpoint,
			region: b.region,
			// AWS by the bucket's host name; the rest (R2, Backblaze, MinIO…) take it in the path.
			forcePathStyle: !new URL(b.endpoint).hostname.endsWith('amazonaws.com'),
			credentials: { accessKeyId: b.accessKeyId, secretAccessKey: b.secretAccessKey },
			requestHandler: { requestTimeout: 30_000, connectionTimeout: 10_000 },
			maxAttempts: 2
		});
		ownClients.set(id, s3);
	}
	const ready = s3;
	return { own: true, client: async () => ready, bucket: b.bucket, root: b.prefix };
}

const keyIn = (p: Place, area: string, name: string) => `${p.root}${area}/${name}`;

const notThere = (err: unknown) => {
	const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
	return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404;
};

/** A place's files, by area and name: for the copy (storage-bucket.ts) and here. */
export function sideOf(p: Place): Side & {
	remove(area: string, name: string): Promise<void>;
	list(area: string): Promise<string[]>;
} {
	return {
		async size(area, name) {
			try {
				const head = await (
					await p.client()
				).send(new HeadObjectCommand({ Bucket: p.bucket, Key: keyIn(p, area, name) }));
				return head.ContentLength ?? 0;
			} catch (err) {
				if (notThere(err)) return null;
				throw err;
			}
		},
		async get(area, name) {
			try {
				const object = await (
					await p.client()
				).send(new GetObjectCommand({ Bucket: p.bucket, Key: keyIn(p, area, name) }));
				return object.Body ? new Uint8Array(await object.Body.transformToByteArray()) : null;
			} catch (err) {
				if (notThere(err)) return null;
				throw err;
			}
		},
		async put(area, name, body, contentType = 'application/octet-stream') {
			await (
				await p.client()
			).send(
				new PutObjectCommand({
					Bucket: p.bucket,
					Key: keyIn(p, area, name),
					Body: body,
					ContentType: contentType
				})
			);
		},
		async remove(area, name) {
			await (
				await p.client()
			).send(new DeleteObjectCommand({ Bucket: p.bucket, Key: keyIn(p, area, name) }));
		},
		async list(area) {
			const s3 = await p.client();
			const prefix = keyIn(p, area, '');
			const names: string[] = [];
			let token: string | undefined;
			do {
				const page = await s3.send(
					new ListObjectsV2Command({ Bucket: p.bucket, Prefix: prefix, ContinuationToken: token })
				);
				for (const object of page.Contents ?? [])
					if (object.Key) names.push(object.Key.slice(prefix.length));
				token = page.IsTruncated ? page.NextContinuationToken : undefined;
			} while (token);
			return names;
		}
	};
}

export interface Places {
	/** Where they are: read from here first. */
	from: Place;
	/** Where they are going, while moving: written here too, and read if not in `from`. */
	to: Place | null;
}

/** Each family's places, a while: asked on every file. Forgotten when they change. */
const placesCache = new Map<string, { at: number; places: Promise<Places> }>();
const PLACES_MS = 30_000;

export const forgetPlaces = (familyId: string) => placesCache.delete(familyId);

/** A family's own bucket, sealed in `family_storage`, opened. */
export async function openBucket(familyId: string, sealed: string): Promise<Bucket> {
	const text = await openFor(familyId, sealed);
	if (!text)
		error(503, 'No se puede abrir la conexión con vuestro almacenamiento. Prueba en un rato');
	return JSON.parse(text) as Bucket;
}

export function placesOf(familyId: string): Promise<Places> {
	const cached = placesCache.get(familyId);
	if (cached && Date.now() - cached.at < PLACES_MS) return cached.places;
	const places = (async () => {
		const row = await familyStorage.of(familyId);
		const at = async (sealed: string | null) =>
			sealed ? ownPlace(await openBucket(familyId, sealed)) : seilidePlace(familyId);
		return {
			from: await at(row?.current ?? null),
			to: row?.moving ? await at(row.next) : null
		};
	})();
	places.catch(() => placesCache.delete(familyId));
	placesCache.set(familyId, { at: Date.now(), places });
	return places;
}

/** Its own storage failed: said in the log and to who runs the family; 502 with what to do. */
async function ownFailed(familyId: string, err: unknown): Promise<never> {
	const problem = bucketProblem(err);
	console.warn('[ficheros] Falla el almacenamiento de la familia', { familyId, problem });
	void warnOwnStorage(familyId, problem).catch(() => {});
	error(
		502,
		`Vuestro almacenamiento no responde: ${problem}. Revísalo en Ajustes → Familia → Espacio`
	);
}

/** In `p`: its own storage's failures said as such; Seilide's, as they are. */
const inPlace = async <T>(familyId: string, p: Place, work: () => Promise<T>) => {
	try {
		return await work();
	} catch (err) {
		if (p.own && !isHttpError(err)) return ownFailed(familyId, err);
		throw err;
	}
};

/**
 * Beside BODY_SIZE_LIMIT (Dockerfile), for what the server makes itself: no family's file is
 * bigger. The waiting phrases, not counted, are not held to it.
 */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * A family's file, kept. In Seilide's storage, refused with 507 if it does not fit in its quota
 * (file-quota.ts); `quota: false` for what moves between families (#315), never refused halfway.
 * While moving, kept where it was and, if it can be, where it goes (the copy mends it if not).
 */
export async function putFile(
	familyId: string,
	area: string,
	name: string,
	body: Uint8Array,
	contentType: string,
	{ quota = true }: { quota?: boolean } = {}
) {
	checkName(name);
	const { from, to } = await placesOf(familyId);
	const counted = quota && !UNCOUNTED_AREAS.has(area);
	if (counted && body.length > MAX_FILE_BYTES) error(413, 'El fichero es demasiado grande');
	// Held to the quota only in Seilide's storage, and not while leaving it.
	const room =
		counted && !from.own && !to ? await fileQuota.room(familyId, area, name, body.length) : null;
	if (room && !room.fits) {
		console.warn('[ficheros] Sin espacio', { familyId, area, used: room.used, limit: room.limit });
		error(507, fullText(room.limit));
	}
	await inPlace(familyId, from, () => sideOf(from).put(area, name, body, contentType));
	if (to)
		await sideOf(to)
			.put(area, name, body, contentType)
			.catch((err) =>
				console.warn('[ficheros] No se pudo guardar también en el destino', {
					familyId,
					problem: bucketProblem(err)
				})
			);
	await fileQuota.kept(familyId, area, name, body.length);
	if (room?.crossesWarning)
		void warnAlmostFull(familyId).catch((err) =>
			console.warn('[ficheros] No se pudo avisar del espacio', String(err))
		);
}

/**
 * A file refused by `putFile` (no room, too big, its own storage failing): its status and what to
 * tell; null, another failure.
 */
export function refused(err: unknown) {
	return isHttpError(err, 507) || isHttpError(err, 413) || isHttpError(err, 502)
		? { status: err.status, message: err.body.message }
		: null;
}

export async function removeFile(familyId: string, area: string, name: string) {
	checkName(name);
	const { from, to } = await placesOf(familyId);
	await inPlace(familyId, from, () => sideOf(from).remove(area, name));
	if (to)
		await sideOf(to)
			.remove(area, name)
			.catch(() => {});
	await fileQuota.forgotten(familyId, area, name);
}

/** Its bytes, or null if it is not there. Its own storage failing, 502 (Seilide's: null). */
export async function readFile(familyId: string, area: string, name: string) {
	checkName(name);
	const { from, to } = await placesOf(familyId);
	try {
		const bytes = await inPlace(familyId, from, () => sideOf(from).get(area, name));
		if (bytes || !to) return bytes;
		return await sideOf(to).get(area, name);
	} catch (err) {
		if (isHttpError(err)) throw err;
		return null;
	}
}

/** The names in a family's area (S3 lists a thousand at a time: followed to the end). */
export async function listFiles(familyId: string, area: string) {
	const { from, to } = await placesOf(familyId);
	const names = new Set(await inPlace(familyId, from, () => sideOf(from).list(area)));
	if (to) for (const name of await sideOf(to).list(area)) names.add(name);
	return [...names];
}

/**
 * A file, from a family to another (#315). One that is not there is said, and is not a failure.
 * Both in Seilide's storage, copied there; otherwise read from one and kept in the other.
 */
export async function copyFile(fromFamily: string, toFamily: string, area: string, name: string) {
	checkName(name);
	const source = await placesOf(fromFamily);
	const target = await placesOf(toFamily);
	if (!source.from.own && !source.to && !target.from.own && !target.to) {
		const s3 = await storage();
		try {
			await s3.send(
				new CopyObjectCommand({
					Bucket: S3_BUCKET,
					CopySource: `${S3_BUCKET}/${keyIn(source.from, area, name)}`,
					Key: keyIn(target.from, area, name)
				})
			);
			const size = await sideOf(target.from).size(area, name);
			await fileQuota.kept(toFamily, area, name, size ?? 0);
		} catch (error) {
			if ((error as { name?: string }).name !== 'NoSuchKey') throw error;
			console.warn('[ficheros] No está para copiarlo', area, name);
		}
		return;
	}
	const bytes = await readFile(fromFamily, area, name);
	if (!bytes) {
		console.warn('[ficheros] No está para copiarlo', area, name);
		return;
	}
	await putFile(toFamily, area, name, bytes, 'application/octet-stream', { quota: false });
}

/**
 * All of a family's files, whatever their area: the family is gone (#315). Only in Seilide's
 * storage: what is in its own is its own, and stays there (only its keys are forgotten).
 */
export async function removeAllFiles(familyId: string) {
	await removeSeilideCopies(familyId);
	await fileQuota.forgottenAll(familyId);
}

/** Every file of the family in Seilide's storage: gone, or its week after moving out is over. */
export async function removeSeilideCopies(familyId: string) {
	const s3 = await storage();
	const prefix = `familias/${familyId}/`;
	let token: string | undefined;
	do {
		const page = await s3.send(
			new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token })
		);
		for (const object of page.Contents ?? [])
			if (object.Key)
				await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: object.Key }));
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
}

/**
 * `stored_file` set right against Seilide's bucket (file-quota.ts): at the server's start, so the
 * files from before #480 are counted and what went wrong between the two is mended. Families with
 * their own storage, or moving, are skipped: their files are not (only) here.
 */
export async function reconcileFiles() {
	if (!client) return;
	const s3 = await storage();
	const skip = await familyStorage.notInSeilide();
	const objects: StoredObject[] = [];
	let token: string | undefined;
	do {
		const page = await s3.send(
			new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: 'familias/', ContinuationToken: token })
		);
		for (const object of page.Contents ?? []) {
			const [, familyId, area, name, ...more] = object.Key?.split('/') ?? [];
			if (familyId && area && name && !more.length)
				objects.push({ familyId, area, name, bytes: object.Size ?? 0 });
		}
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	const { added, removed } = await fileQuota.reconcile(objects, skip);
	if (added || removed)
		console.log('[ficheros] Espacio de las familias al día', { added, removed });
}

/** As a page's response: the family's file, kept a while in the browser (it does not change). */
export async function fileResponse(familyId: string, area: string, name: string, type: string) {
	const bytes = await readFile(familyId, area, name);
	if (!bytes) error(404, 'Fichero no encontrado');
	return new Response(bytes, {
		headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' }
	});
}
