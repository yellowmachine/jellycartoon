/**
 * A file shared to the app from another (the manifest's share_target, #232): a bill's PDF from the
 * power company's app. The service worker keeps it here and opens Gastos, which takes it once.
 * https://developer.chrome.com/docs/capabilities/web-apis/web-share-target#accepting_files
 */

export const SHARED_CACHE = 'compartido';
export const SHARED_KEY = '/compartido/archivo';

export async function takeSharedFile(): Promise<File | null> {
	if (!('caches' in globalThis)) return null;
	const cache = await caches.open(SHARED_CACHE);
	const res = await cache.match(SHARED_KEY);
	if (!res) return null;
	await cache.delete(SHARED_KEY);
	const name = decodeURIComponent(res.headers.get('x-name') ?? 'compartido');
	return new File([await res.blob()], name, { type: res.headers.get('content-type') ?? '' });
}

/**
 * Kept for a page to take: shared to the app (by the service worker), or read in Gastos and found
 * to be an income (a pension's transfer from the bank's app), for Ingresos.
 */
export async function passSharedFile(file: Blob, name: string) {
	if (!('caches' in globalThis)) return false;
	const cache = await caches.open(SHARED_CACHE);
	await cache.put(
		SHARED_KEY,
		new Response(file, {
			headers: { 'content-type': file.type, 'x-name': encodeURIComponent(name) }
		})
	);
	return true;
}
