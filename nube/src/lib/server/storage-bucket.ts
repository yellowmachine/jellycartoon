import { isIP } from 'node:net';

/**
 * A family's own storage (#480, phase 2), apart from the S3 client and the env, to be tried on its
 * own: what the family writes of its bucket, checked; the S3 errors, said as the family reads them;
 * and the copy of its files from one storage to another, which can be run again as many times as it
 * takes: what is already there, the same size, is skipped.
 */

export interface Bucket {
	/** `https://<account>.r2.cloudflarestorage.com`, `https://s3.eu-west-1.amazonaws.com`… */
	endpoint: string;
	/** `auto` for R2; the bucket's for AWS, Backblaze, Scaleway… */
	region: string;
	bucket: string;
	/** Its folder in the bucket, `seilide/` by default; empty, the bucket's root. */
	prefix: string;
	accessKeyId: string;
	secretAccessKey: string;
}

export const DEFAULT_PREFIX = 'seilide/';

/** The bucket as the form sent it, or what is wrong with it. */
export function bucketFrom(form: {
	get(name: string): FormDataEntryValue | null;
}): Bucket | { problem: string } {
	const text = (name: string) => String(form.get(name) ?? '').trim();
	let endpoint: URL;
	try {
		endpoint = new URL(text('endpoint'));
	} catch {
		return { problem: 'Escribe la dirección completa del almacenamiento, con https://' };
	}
	const bucket = text('bucket');
	if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
		return {
			problem: 'Ese nombre de bucket no vale: letras minúsculas, números, puntos y guiones'
		};
	const prefix = folderOf(form.get('prefix') === null ? DEFAULT_PREFIX : text('prefix'));
	if (prefix === null)
		return { problem: 'La carpeta solo puede tener letras, números, guiones, puntos y /' };
	const accessKeyId = text('accessKeyId');
	const secretAccessKey = text('secretAccessKey');
	if (!accessKeyId || !secretAccessKey) return { problem: 'Faltan las claves de acceso' };
	return {
		endpoint: endpoint.origin,
		region: text('region') || 'auto',
		bucket,
		prefix,
		accessKeyId,
		secretAccessKey
	};
}

/** `seilide`, `/seilide/` → `seilide/`; empty, the root; null, not a folder's name. */
export function folderOf(text: string) {
	const parts = text.split('/').filter(Boolean);
	if (parts.some((p) => !/^[\w.-]+$/.test(p) || p === '.' || p === '..')) return null;
	return parts.length ? `${parts.join('/')}/` : '';
}

/** What it says, without its keys: «abc.r2.cloudflarestorage.com · fotos · seilide/». */
export const labelOf = (b: Bucket) =>
	[new URL(b.endpoint).host, b.bucket, b.prefix].filter(Boolean).join(' · ');

/** The same place (another key for it is not a move). */
export const samePlace = (a: Bucket, b: Bucket) =>
	a.endpoint === b.endpoint && a.bucket === b.bucket && a.prefix === b.prefix;

/**
 * An address of this machine, its network or the VPS's containers, never to be reached by what a
 * family writes: loopback, private, link-local (the clouds' metadata), CGNAT, unique local.
 */
export function isPrivateAddress(ip: string) {
	if (isIP(ip) === 4) {
		const [a, b] = ip.split('.').map(Number) as [number, number];
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			a >= 224
		);
	}
	const v6 = ip.toLowerCase();
	if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
	return (
		v6 === '::' ||
		v6 === '::1' ||
		v6.startsWith('fc') ||
		v6.startsWith('fd') ||
		v6.startsWith('fe8') ||
		v6.startsWith('fe9') ||
		v6.startsWith('fea') ||
		v6.startsWith('feb')
	);
}

/**
 * Whether Seilide may reach that endpoint: https, a name with a dot, and none of its addresses
 * private (`lookup`, node:dns's). What is wrong, or null. `allowHttp`: the tests' and development's
 * own rustfs.
 */
export async function endpointProblem(
	endpoint: string,
	lookup: (host: string) => Promise<{ address: string }[]>,
	{ allowPrivate = false }: { allowPrivate?: boolean } = {}
) {
	const url = new URL(endpoint);
	if (allowPrivate) return null;
	if (url.protocol !== 'https:') return 'La dirección tiene que empezar por https://';
	const host = url.hostname.replace(/^\[|\]$/g, '');
	if (isIP(host)) return isPrivateAddress(host) ? 'Esa dirección no se puede usar' : null;
	if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal'))
		return 'Esa dirección no se puede usar';
	let addresses: { address: string }[];
	try {
		addresses = await lookup(host);
	} catch {
		return `No se encuentra ${host}`;
	}
	if (!addresses.length) return `No se encuentra ${host}`;
	if (addresses.some((a) => isPrivateAddress(a.address))) return 'Esa dirección no se puede usar';
	return null;
}

/** An S3 error, as the family reads it. */
export function bucketProblem(err: unknown) {
	const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
	const name = e?.Code ?? e?.name ?? '';
	const status = e?.$metadata?.httpStatusCode;
	if (
		['InvalidAccessKeyId', 'SignatureDoesNotMatch', 'InvalidToken', 'ExpiredToken'].includes(name)
	)
		return 'Las claves de acceso no valen o han caducado';
	if (name === 'NoSuchBucket') return 'Ese bucket no existe';
	if (name === 'AccessDenied' || status === 403)
		return 'Las claves no valen o no tienen permiso para leer, escribir, listar y borrar en ese bucket';
	if (name === 'PermanentRedirect' || name === 'AuthorizationHeaderMalformed' || status === 301)
		return 'La región no es la del bucket';
	if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'TimeoutError'].includes(name))
		return 'No se llega al almacenamiento';
	if (!e?.$metadata && err instanceof Error && err.name === 'Error')
		return `El almacenamiento ha fallado: ${err.message}`;
	return `El almacenamiento ha fallado${name ? ` (${name})` : ''}`;
}

/** One side of a copy: a storage, by each file's area and name. */
export interface Side {
	/** Its size there; null, not there. */
	size(area: string, name: string): Promise<number | null>;
	get(area: string, name: string): Promise<Uint8Array<ArrayBuffer> | null>;
	put(area: string, name: string, body: Uint8Array, contentType?: string): Promise<void>;
}

export interface FileRef {
	area: string;
	name: string;
}

export interface CopyResult {
	/** Copied or already there. */
	done: number;
	/** Not in `from` (gone meanwhile): skipped. */
	missing: number;
	/** Why it stopped; null, all there. */
	problem: string | null;
}

/**
 * Each file from `from` to `to`, unless it is already there with its size: stopped halfway, run
 * again and only what is missing goes. A file that fails is tried `tries` times; then the copy stops
 * with why, as the next would fail the same. `stopped`, asked between files: cancelled meanwhile.
 */
export async function copyFiles({
	files,
	from,
	to,
	onProgress = async () => {},
	stopped = async () => false,
	tries = 3,
	wait = (ms) => new Promise((r) => setTimeout(r, ms))
}: {
	files: FileRef[];
	from: Side;
	to: Side;
	onProgress?: (done: number) => Promise<void>;
	stopped?: () => Promise<boolean>;
	tries?: number;
	wait?: (ms: number) => Promise<unknown>;
}): Promise<CopyResult> {
	let done = 0;
	let missing = 0;
	for (const f of files) {
		if (await stopped()) return { done, missing, problem: null };
		let last: unknown = null;
		for (let attempt = 0; attempt < tries; attempt++) {
			try {
				last = null;
				const there = await from.size(f.area, f.name);
				if (there === null) {
					missing++;
					break;
				}
				if ((await to.size(f.area, f.name)) === there) break;
				const body = await from.get(f.area, f.name);
				if (!body) {
					missing++;
					break;
				}
				await to.put(f.area, f.name, body);
				if ((await to.size(f.area, f.name)) !== body.length)
					throw new Error('El fichero no ha llegado entero');
				break;
			} catch (err) {
				last = err;
				if (attempt < tries - 1) await wait(1000 * 4 ** attempt);
			}
		}
		if (last) return { done, missing, problem: bucketProblem(last) };
		done++;
		await onProgress(done);
	}
	return { done, missing, problem: null };
}
