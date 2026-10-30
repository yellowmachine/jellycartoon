import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

/**
 * Fetching an address a user gave (a recipe's page): only from the public internet. Without this
 * check, a link to 127.0.0.1, to the compose's services (the database, WUD with Docker's socket)
 * or to the house's network would be fetched from inside, by the server: SSRF,
 * https://owasp.org/www-community/attacks/Server_Side_Request_Forgery
 *
 * The name is looked up first and every address it has must be public; each redirect is checked
 * again. The lookup and fetch's own can differ (DNS rebinding): enough for a house's app whose
 * users are signed in, not for a public service.
 */

const blocked = new BlockList();
for (const [net, prefix] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	// Carrier-grade NAT, also VPNs' (Tailscale's).
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
] as const)
	blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
	['::', 128],
	['::1', 128],
	['fc00::', 7],
	['fe80::', 10],
	['ff00::', 8]
] as const)
	blocked.addSubnet(net, prefix, 'ipv6');

/** Whether an IP is on the public internet. An IPv4 written as IPv6 (`::ffff:10.0.0.1`) too. */
export function isPublicAddress(ip: string) {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
	if (mapped) ip = mapped;
	const family = isIP(ip);
	if (!family) return false;
	return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

async function assertPublic(url: URL) {
	if (url.protocol !== 'http:' && url.protocol !== 'https:')
		throw new Error('La dirección tiene que empezar por http:// o https://');
	if (url.username || url.password) throw new Error('La dirección no puede llevar usuario');
	const host = url.hostname.replace(/^\[|\]$/g, '');
	const addresses = isIP(host)
		? [host]
		: (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
	if (!addresses.length) throw new Error(`No existe la web ${host}`);
	if (!addresses.every(isPublicAddress))
		throw new Error('Esa dirección no es de internet: no se descarga');
}

const MAX_REDIRECTS = 5;

/** The site answered with an error: its HTTP status, to tell «stop for a while» (429…) apart. */
export class FetchError extends Error {
	constructor(readonly status: number) {
		super(`La web respondió ${status}`);
	}
}

const decoder = new TextDecoder();

/** A file served gzipped as it is (a sitemap's `.xml.gz`), not with Content-Encoding: by its magic bytes. */
const isGzip = (bytes: Uint8Array) => bytes[0] === 0x1f && bytes[1] === 0x8b;

/**
 * https://developer.mozilla.org/docs/Web/API/DecompressionStream, stopped as soon as it goes over
 * `max`: a small file can unpack into an enormous one.
 */
async function gunzip(bytes: Uint8Array<ArrayBuffer>, max: number) {
	const reader = new Blob([bytes])
		.stream()
		.pipeThrough(new DecompressionStream('gzip'))
		.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > max) {
			await reader.cancel();
			throw new Error('La página es demasiado grande');
		}
		chunks.push(value);
	}
	return decoder.decode(Buffer.concat(chunks));
}

/**
 * GET of a public web address, following its redirects (each checked), up to `maxBytes`, as it
 * came: for a picture. Why not, in Spanish, if it cannot be.
 */
export async function fetchPublicBytes(
	address: string,
	options: { headers?: HeadersInit; timeoutMs?: number; maxBytes: number }
) {
	let url: URL;
	try {
		url = new URL(address);
	} catch {
		throw new Error('Eso no es una dirección web');
	}
	const signal = AbortSignal.timeout(options.timeoutMs ?? 20_000);
	for (let hop = 0; ; hop++) {
		await assertPublic(url);
		const res = await fetch(url, { headers: options.headers, redirect: 'manual', signal }).catch(
			(err) => {
				throw new Error(`No se pudo descargar: ${err instanceof Error ? err.message : err}`);
			}
		);
		const location = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && location) {
			if (hop >= MAX_REDIRECTS) throw new Error('Demasiadas redirecciones');
			url = new URL(location, url);
			continue;
		}
		if (!res.ok) throw new FetchError(res.status);
		if (Number(res.headers.get('content-length') ?? 0) > options.maxBytes)
			throw new Error('La página es demasiado grande');
		const bytes = new Uint8Array(await res.arrayBuffer());
		if (bytes.length > options.maxBytes) throw new Error('La página es demasiado grande');
		return { url: url.href, bytes, contentType: res.headers.get('content-type') ?? '' };
	}
}

/**
 * GET of a public web address, following its redirects (each checked), up to `maxBytes`, as text.
 * Why not, in Spanish, if it cannot be.
 */
export async function fetchPublic(
	address: string,
	options: { headers?: HeadersInit; timeoutMs?: number; maxBytes: number }
) {
	const { url, bytes, contentType } = await fetchPublicBytes(address, options);
	const body = isGzip(bytes) ? await gunzip(bytes, options.maxBytes) : decoder.decode(bytes);
	return { url, body, contentType };
}
