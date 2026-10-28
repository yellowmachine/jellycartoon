import {
	CopyObjectCommand,
	CreateBucketCommand,
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { error } from '@sveltejs/kit';
import { S3_ACCESS_KEY_ID, S3_BUCKET, S3_ENDPOINT, S3_SECRET_ACCESS_KEY } from '$app/env/private';

/**
 * The families' files (#253): receipts' photos and bills' PDFs, in an S3 storage (the stack's own
 * rustfs, compose.prod.yaml), each under its family (`familias/<id>/…`), never served from it
 * directly: the app gives them only to that family's people. The bucket, made if it is not there.
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

export async function putFile(
	familyId: string,
	area: string,
	name: string,
	body: Uint8Array,
	contentType: string
) {
	const s3 = await storage();
	await s3.send(
		new PutObjectCommand({
			Bucket: S3_BUCKET,
			Key: keyOf(familyId, area, name),
			Body: body,
			ContentType: contentType
		})
	);
}

/** Renamed (S3 has no rename: a copy, and the old one out). False if it was not there. */
export async function renameFile(familyId: string, area: string, from: string, to: string) {
	const s3 = await storage();
	try {
		await s3.send(
			new CopyObjectCommand({
				Bucket: S3_BUCKET,
				CopySource: `${S3_BUCKET}/${keyOf(familyId, area, from)}`,
				Key: keyOf(familyId, area, to)
			})
		);
	} catch {
		return false;
	}
	await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: keyOf(familyId, area, from) }));
	return true;
}

export async function removeFile(familyId: string, area: string, name: string) {
	const s3 = await storage();
	await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: keyOf(familyId, area, name) }));
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

/** As a page's response: the family's file, kept a while in the browser (it does not change). */
export async function fileResponse(familyId: string, area: string, name: string, type: string) {
	const bytes = await readFile(familyId, area, name);
	if (!bytes) error(404, 'Fichero no encontrado');
	return new Response(bytes, {
		headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' }
	});
}
