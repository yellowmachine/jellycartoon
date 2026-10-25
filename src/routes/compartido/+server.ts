import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchPlaces } from '#lib/server/road/ors.ts';
import { isMapShare, sharedPlace } from '#lib/server/road/shared-place.ts';

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
