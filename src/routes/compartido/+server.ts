import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchPlaces } from '#lib/server/road/ors.ts';
import { isMapShare, sharedPlace } from 'comun/road/shared-place.ts';

/**
 * Where «Compartir → JellyCartoon» lands (the manifest's share_target), from a phone or the car's
 * tablet: a place from a map goes to Carretera, with its route at once; anything else, to the
 * recipes, as before. From Android the shared address comes inside `text`, not in `url`.
 */
export const GET: RequestHandler = async ({ url }) => {
	const text = ['title', 'text', 'url']
		.map((key) => url.searchParams.get(key)?.trim())
		.filter(Boolean)
		.join(' ')
		.slice(0, 2000);
	if (!isMapShare(text)) redirect(303, `/recetas?${url.searchParams}`);

	const place = await sharedPlace(text);
	const name = place?.name ?? 'Sitio compartido';
	if (place?.at) redirect(303, destination(place.at, name));
	// Only its name and address (Google's phone app): searched as it was written, then the address
	// alone; not found, in Carretera's box to search by hand.
	const search = place?.search;
	if (search) {
		const address = search.split(',').slice(1).join(',').trim();
		for (const q of [search, address].filter(Boolean)) {
			const [found] = await searchPlaces(q, null).catch(() => []);
			if (found) redirect(303, destination(found.at, name));
		}
	}
	redirect(303, `/carretera?${new URLSearchParams({ buscar: place?.name ?? search ?? text })}`);
};

const destination = ([lon, lat]: [number, number], name: string) =>
	`/carretera?${new URLSearchParams({ destino: `${lon},${lat}`, nombre: name })}`;

/**
 * The share_target is a POST since #232, for files; the service worker takes it. Without one yet
 * (the app opened for the first time), here: a link or a text, to the GET as before; a file
 * cannot reach the page from here, so Gastos says to share it again.
 */
export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData().catch(() => null);
	// A file (a bill's PDF): Gastos is in the cloud (#253), shared to its app instead.
	if (form?.get('archivo') instanceof File) redirect(303, '/gastos');
	const params = new URLSearchParams();
	for (const key of ['title', 'text', 'url']) {
		const value = form?.get(key);
		if (typeof value === 'string' && value) params.set(key, value);
	}
	redirect(303, `/compartido?${params}`);
};
