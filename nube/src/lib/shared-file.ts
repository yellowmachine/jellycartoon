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
