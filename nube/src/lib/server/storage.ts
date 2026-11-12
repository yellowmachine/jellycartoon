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
import { fileQuota, fullText, warnAlmostFull } from './file-quota.ts';
import { UNCOUNTED_AREAS, type StoredObject } from './file-quota-scope.ts';

/**
 * The families' files (#253): receipts' photos and bills' PDFs, in an S3 storage (the stack's own
 * rustfs, compose.prod.yaml), each under its family (`familias/<id>/…`), never served from it
 * directly: the app gives them only to that family's people. The bucket, made if it is not there.
 * What each file takes is kept in `stored_file` (file-quota.ts, #480), to keep each family under
 * its quota: a file that does not fit is refused with 507 and what to do, never half kept.
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

/** A family's file, by its name in that family: only plain names, never a path. */
function keyOf(familyId: string, area: string, name: string) {
	if (!/^[\w.-]+$/.test(name) || name.startsWith('.'))
		throw new Error('Nombre de fichero no válido');
	return `familias/${familyId}/${area}/${name}`;
}

/**
 * Beside BODY_SIZE_LIMIT (Dockerfile), for what the server makes itself: no family's file is
 * bigger. The waiting phrases, not counted, are not held to it.
 */
export const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * A family's file, kept. Refused with 507 if it does not fit in its quota (file-quota.ts); `quota:
 * false` for what moves between families (#315), never refused halfway.
 */
export async function putFile(
	familyId: string,
	area: string,
	name: string,
	body: Uint8Array,
	contentType: string,
	{ quota = true }: { quota?: boolean } = {}
) {
	const s3 = await storage();
	keyOf(familyId, area, name);
	const counted = quota && !UNCOUNTED_AREAS.has(area);
	if (counted && body.length > MAX_FILE_BYTES) error(413, 'El fichero es demasiado grande');
	const room = counted ? await fileQuota.room(familyId, area, name, body.length) : null;
	if (room && !room.fits) {
		console.warn('[ficheros] Sin espacio', { familyId, area, used: room.used, limit: room.limit });
		error(507, fullText(room.limit));
	}
	await s3.send(
		new PutObjectCommand({
			Bucket: S3_BUCKET,
			Key: keyOf(familyId, area, name),
			Body: body,
			ContentType: contentType
		})
	);
	await fileQuota.kept(familyId, area, name, body.length);
	if (room?.crossesWarning)
		void warnAlmostFull(familyId).catch((err) =>
			console.warn('[ficheros] No se pudo avisar del espacio', String(err))
		);
}

/** A file refused by `putFile` (no room, too big): its status and what to tell; null, another failure. */
export function refused(err: unknown) {
	return isHttpError(err, 507) || isHttpError(err, 413)
		? { status: err.status, message: err.body.message }
		: null;
}

export async function removeFile(familyId: string, area: string, name: string) {
	const s3 = await storage();
	await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: keyOf(familyId, area, name) }));
	await fileQuota.forgotten(familyId, area, name);
}

/** Its bytes, or null if it is not there. */
export async function readFile(familyId: string, area: string, name: string) {
	const s3 = await storage();
	try {
		const object = await s3.send(
			new GetObjectCommand({ Bucket: S3_BUCKET, Key: keyOf(familyId, area, name) })
		);
		return object.Body ? new Uint8Array(await object.Body.transformToByteArray()) : null;
	} catch {
		return null;
	}
}

/** The names in a family's area (S3 lists a thousand at a time: followed to the end). */
export async function listFiles(familyId: string, area: string) {
	const s3 = await storage();
	const prefix = `familias/${familyId}/${area}/`;
	const names: string[] = [];
	let token: string | undefined;
	do {
		const page = await s3.send(
			new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: prefix, ContinuationToken: token })
		);
		for (const object of page.Contents ?? [])
			if (object.Key) names.push(object.Key.slice(prefix.length));
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	return names;
}

/** A file, from a family to another (#315). One that is not there is said, and is not a failure. */
export async function copyFile(fromFamily: string, toFamily: string, area: string, name: string) {
	const s3 = await storage();
	try {
		await s3.send(
			new CopyObjectCommand({
				Bucket: S3_BUCKET,
				CopySource: `${S3_BUCKET}/${keyOf(fromFamily, area, name)}`,
				Key: keyOf(toFamily, area, name)
			})
		);
		const from = await s3.send(
			new HeadObjectCommand({ Bucket: S3_BUCKET, Key: keyOf(toFamily, area, name) })
		);
		await fileQuota.kept(toFamily, area, name, from.ContentLength ?? 0);
	} catch (error) {
		if ((error as { name?: string }).name !== 'NoSuchKey') throw error;
		console.warn('[ficheros] No está para copiarlo', area, name);
	}
}

/** All of a family's files, whatever their area: the family is gone (#315). */
export async function removeAllFiles(familyId: string) {
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
	await fileQuota.forgottenAll(familyId);
}

/**
 * `stored_file` set right against the bucket (file-quota.ts): at the server's start, so the files
 * from before #480 are counted and what went wrong between the two is mended.
 */
export async function reconcileFiles() {
	if (!client) return;
	const s3 = await storage();
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
	const { added, removed } = await fileQuota.reconcile(objects);
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
