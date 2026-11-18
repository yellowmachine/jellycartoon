import { GetObjectCommand, ListObjectsV2Command, type S3Client } from '@aws-sdk/client-s3';
import { parseContentRange, tokenizer, type IRangeRequestClient } from '@tokenizer/range';
import { parseFromTokenizer } from 'music-metadata';
import type { Bucket } from './storage-bucket.ts';
import type { Listed } from './own-music-index.ts';

/**
 * «Tu música» (#534), reading the family's bucket: its keys, and each audio's tags by ranges, only
 * what music-metadata asks for. Apart from the app (no database, no env), to be tried against a
 * real S3.
 */

/** Each key under the bucket's folder, with its ETag and size (a thousand at a time). */
export async function listAll(s3: S3Client, b: Bucket) {
	const objects: Listed[] = [];
	let token: string | undefined;
	do {
		const page = await s3.send(
			new ListObjectsV2Command({ Bucket: b.bucket, Prefix: b.prefix, ContinuationToken: token })
		);
		for (const o of page.Contents ?? [])
			if (o.Key && !o.Key.endsWith('/'))
				objects.push({ key: o.Key, etag: (o.ETag ?? '').replaceAll('"', ''), size: o.Size ?? 0 });
		token = page.IsTruncated ? page.NextContinuationToken : undefined;
	} while (token);
	return objects;
}

/** The bucket's ranges as music-metadata reads them (@tokenizer/range): only what it asks for. */
function rangeClient(s3: S3Client, b: Bucket, key: string): IRangeRequestClient {
	const abort = new AbortController();
	return {
		async getResponse(_method, range) {
			const res = await s3.send(
				new GetObjectCommand({
					Bucket: b.bucket,
					Key: key,
					Range: range ? `bytes=${range[0]}-${range[1]}` : undefined
				}),
				{ abortSignal: abort.signal }
			);
			const contentRange = res.ContentRange ? parseContentRange(res.ContentRange) : undefined;
			return {
				size: contentRange?.instanceLength ?? res.ContentLength ?? 0,
				// By its name: what the bucket says (application/octet-stream, often) would mislead it.
				path: key,
				contentRange,
				acceptPartialRequests: true,
				arrayBuffer: async () => new Uint8Array(await res.Body!.transformToByteArray())
			};
		},
		abort: () => abort.abort()
	};
}

export async function readTags(s3: S3Client, b: Bucket, key: string) {
	const tk = await tokenizer(rangeClient(s3, b, key), {
		avoidHeadRequests: true,
		initialChunkSize: 64 * 1024,
		minimumChunkSize: 64 * 1024,
		timeoutInSec: 30
	});
	try {
		// The duration of an Ogg is in its last page, read from the end (a range more); the others' is
		// in their headers, and `duration: true` would read an MP3 without one whole.
		return await parseFromTokenizer(tk, { duration: /\.(ogg|oga|opus)$/i.test(key) });
	} finally {
		await tk.close().catch(() => {});
	}
}
