import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isMapShare, sharedPlace } from 'comun/road/shared-place.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { orsFor } from '#lib/server/road/ors.ts';

/**
 * Where «Compartir → Nube» lands (the manifest's share_target): a place from a map goes to
 * Carretera, with its route at once (jellycartoon's, #78); another link (a recipe's page), to
 * Recetas, waiting in its box; a file, through the service worker, to Gastos. From Android the
 * shared address comes inside `text`, not in `url`.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const text = ['title', 'text', 'url']
		.map((key) => url.searchParams.get(key)?.trim())
		.filter(Boolean)
		.join(' ')
		.slice(0, 2000);
	if (isMapShare(text)) redirect(303, await toRoad(text, locals.user!.id));
	const shared = ['url', 'text', 'title']
		.map((key) => url.searchParams.get(key)?.match(/https?:\/\/\S+/)?.[0] ?? null)
		.find(Boolean);
	redirect(303, shared ? `/recetas?url=${encodeURIComponent(shared)}` : '/');
};

/**
 * A place shared from a map: its route; with only its name and address (Google's phone app),
 * searched as written, then the address alone; not found, in Carretera's box to search by hand.
 */
async function toRoad(text: string, userId: string) {
	const place = await sharedPlace(text);
	const name = place?.name ?? 'Sitio compartido';
	if (place?.at) return destination(place.at, name);
	const search = place?.search;
	if (search) {
		const { searchPlaces } = orsFor(await kitchenOf(userId));
		const address = search.split(',').slice(1).join(',').trim();
		for (const q of [search, address].filter(Boolean)) {
			const [found] = await searchPlaces(q, null).catch(() => []);
			if (found) return destination(found.at, name);
		}
	}
	return `/carretera?${new URLSearchParams({ buscar: place?.name ?? search ?? text })}`;
}

const destination = ([lon, lat]: [number, number], name: string) =>
	`/carretera?${new URLSearchParams({ destino: `${lon},${lat}`, nombre: name })}`;

/**
 * The share_target is a POST, for files; the service worker takes it. Without one yet (the app
 * opened for the first time), here: a link or a text, to the GET; a file cannot reach the page from
 * here, so Gastos says to share it again.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	const file = form?.get('archivo');
	if (file instanceof File && file.size) redirect(303, '/gastos?compartido=archivo');
	const params = new URLSearchParams();
	for (const key of ['title', 'text', 'url']) {
		const value = form?.get(key);
		if (typeof value === 'string' && value) params.set(key, value);
	}
	redirect(303, `/compartido?${params}`);
};
