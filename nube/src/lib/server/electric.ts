import { error } from '@sveltejs/kit';
import { ELECTRIC_SECRET, ELECTRIC_URL } from '$app/env/private';
import { shapeUrl, type ShapeName } from './electric-shape.ts';

/**
 * El shape de una familia, tal como lo da Electric (#394), para su casa. El único sitio con su
 * dirección y su secreto. Lo que Electric cambia lo avisa en sus cabeceras `electric-*`, y van tal
 * cual; sin caché por el camino, que son datos de una familia.
 */
export async function familyShape(
	familyId: string,
	name: ShapeName,
	query: URLSearchParams,
	signal: AbortSignal
) {
	if (!ELECTRIC_URL || !ELECTRIC_SECRET) error(503, 'Sin Electric');
	const url = shapeUrl({ url: ELECTRIC_URL, secret: ELECTRIC_SECRET }, familyId, name, query);
	// `identity`: fetch descomprime y deja `content-encoding`, y la casa no podría leerlo.
	const response = await fetch(url, { headers: { 'accept-encoding': 'identity' }, signal }).catch(
		() => null
	);
	if (!response) {
		// La casa colgó mientras esperaba cambios: lo normal, y no hay a quién contestar.
		if (signal.aborted) return new Response(null, { status: 499 });
		error(503, 'Electric no responde');
	}
	const headers = new Headers(response.headers);
	headers.delete('content-encoding');
	headers.delete('content-length');
	headers.set('cache-control', 'private, no-store');
	headers.set('vary', 'x-api-key');
	return new Response(response.body, { status: response.status, headers });
}
