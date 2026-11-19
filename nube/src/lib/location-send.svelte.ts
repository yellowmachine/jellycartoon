import type { LngLat } from 'comun/road.ts';
import { tripShare } from '#lib/trip-share.svelte.ts';

/**
 * «Manda mi ubicación a mamá» (#550) from this browser, by voice or by hand: where it is now (asked
 * of the GPS at that moment), or the trip as it goes (#81's sharing, started here if it was not).
 */

export interface SendTo {
	userId: string;
	name: string;
}

/** Where this device is now; it asks for the permission if it was never given. */
export function hereNow(): Promise<LngLat> {
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) return reject(new Error('Este aparato no da su ubicación'));
		navigator.geolocation.getCurrentPosition(
			({ coords }) => resolve([coords.longitude, coords.latitude]),
			(err) =>
				reject(
					new Error(
						err.code === err.PERMISSION_DENIED
							? 'Sin permiso de ubicación: dáselo a Seilide en el navegador'
							: 'No se ha podido saber dónde estás'
					)
				),
			{ enableHighAccuracy: true, timeout: 20_000, maximumAge: 30_000 }
		);
	});
}

/**
 * Sent: the sentence to show. `startShare`: how this page shares the trip (the road mode's, with its
 * destination and arrival); without one, only where it is.
 */
export async function sendMyLocation(
	to: SendTo,
	live: boolean,
	startShare?: () => Promise<void>
): Promise<string> {
	let body: object;
	if (live) {
		if (!tripShare.url)
			await (startShare
				? startShare()
				: tripShare.start(() => ({ destination: null, arrivesAt: null })));
		if (!tripShare.url) throw new Error(tripShare.problem ?? 'No se ha podido compartir el viaje');
		body = { to: to.userId, live: true };
	} else body = { to: to.userId, at: await hereNow() };
	const res = await fetch('/api/ubicacion', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	}).catch(() => null);
	if (!res?.ok) throw new Error((await res?.json().catch(() => null))?.message ?? 'Sin conexión');
	return live ? `${to.name} ya ve tu viaje en directo` : `Mandada a ${to.name}`;
}
