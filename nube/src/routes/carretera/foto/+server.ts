import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { kitchenOf } from '#lib/server/fridge.ts';
import { MAX_PHOTO_BYTES, savePhoto } from '#lib/server/trips/photos.ts';

const num = (value: string | null) => (value === null || value === '' ? null : Number(value));

/**
 * A photo from the road mode (#81): the JPEG as the body; `t` (ms since 1970), `lon` and `lat` in
 * the address, when and where it was taken.
 */
export const POST: RequestHandler = async ({ request, url, locals }) => {
	if (Number(request.headers.get('content-length')) > MAX_PHOTO_BYTES)
		error(413, 'Demasiado grande');
	const jpeg = new Uint8Array(await request.arrayBuffer());
	const t = num(url.searchParams.get('t'));
	const lon = num(url.searchParams.get('lon'));
	const lat = num(url.searchParams.get('lat'));
	// Not later than now (a tablet's clock), nor absurdly early.
	const takenAt = new Date(
		t !== null && Number.isFinite(t) && t > Date.now() - 7 * 86_400_000
			? Math.min(t, Date.now())
			: Date.now()
	);
	const at =
		lon !== null && lat !== null && Math.abs(lon) <= 180 && Math.abs(lat) <= 90
			? ([lon, lat] as [number, number])
			: null;
	try {
		return json({ id: await savePhoto(await kitchenOf(locals.user!.id), jpeg, takenAt, at) });
	} catch (err) {
		console.warn('[viajes] No se pudo guardar una foto', err);
		error(400, err instanceof Error ? err.message : 'No se pudo guardar la foto');
	}
};
