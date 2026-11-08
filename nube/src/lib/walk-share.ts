import { metresBetween } from 'comun/road-guide.ts';
import type { StoredPoint } from '#lib/trips.ts';

/**
 * A walk shared by link (#434): what whoever has the link sees. Almost every walk starts and ends
 * at the door, so its ends are hidden unless said: every position nearer than this to where it
 * started or ended, and the photos taken there. What is left may be several pieces.
 */
export const TRIM_METRES = 250;

/** How many links a person may have alive at once: enough for anyone, not for a flood. */
export const MAX_LIVE_SHARES = 100;

/** «Grupo del cole»: short. */
export const MAX_LABEL = 60;

export type Piece = [number, number][];

/** The way without the hours of each point; trimmed, in the pieces away from both ends. */
export function sharedPieces(line: StoredPoint[], trim: boolean): Piece[] {
	const points = line.map((p): [number, number] => [p[0], p[1]]);
	if (!trim) return points.length ? [points] : [];
	const ends = points.length ? [points[0]!, points.at(-1)!] : [];
	const pieces: Piece[] = [];
	let piece: Piece = [];
	for (const p of points) {
		if (ends.some((end) => metresBetween(end, p) < TRIM_METRES)) {
			if (piece.length) pieces.push(piece);
			piece = [];
		} else piece.push(p);
	}
	if (piece.length) pieces.push(piece);
	// A lone point is no way.
	return pieces.filter((p) => p.length > 1);
}

/** A photo's place, unless it is near either end of a trimmed walk. */
export function sharedPlace(
	line: StoredPoint[],
	trim: boolean,
	photo: { lon: number | null; lat: number | null }
): { lon: number | null; lat: number | null } {
	if (photo.lon === null || photo.lat === null) return { lon: null, lat: null };
	if (!trim || !line.length) return { lon: photo.lon, lat: photo.lat };
	const at: [number, number] = [photo.lon, photo.lat];
	const near = [line[0]!, line.at(-1)!].some(
		(end) => metresBetween([end[0], end[1]], at) < TRIM_METRES
	);
	return near ? { lon: null, lat: null } : { lon: photo.lon, lat: photo.lat };
}

/** «Paseo de Miguel»: by their first name only. */
export function sharedHeading(name: string | null) {
	const first = name?.trim().split(/\s+/)[0];
	return first ? `Paseo de ${first}` : 'Un paseo';
}

/** «Paseo de Miguel · 5,2 km»: what a link's preview shows, never where. */
export const sharedTitle = (name: string | null, distanceText: string) =>
	`${sharedHeading(name)} · ${distanceText}`;

/** Link previews (WhatsApp, Telegram…) fetch the page too: they are not someone opening it. */
export const isPreviewBot = (userAgent: string | null) =>
	/whatsapp|facebookexternalhit|facebot|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|bot\b|crawler|spider/i.test(
		userAgent ?? ''
	);
