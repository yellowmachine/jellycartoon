import type { LngLat } from 'comun/road.ts';
import { fold } from 'comun/music.ts';

/**
 * Places of a kind near a point (#312, phase 2): «una panadería en Totana», from openrouteservice's
 * POIs (OpenStreetMap's, so some may be missing). Shared by the server and its tests.
 */

/**
 * The kinds that can be asked for, as said, and openpoiservice's categories for each:
 * https://github.com/GIScience/openpoiservice/blob/master/openpoiservice/server/categories/categories.yml
 */
export const POI_KINDS = {
	panadería: [426, 506],
	pastelería: [506, 450],
	supermercado: [518, 451, 475],
	carnicería: [434],
	frutería: [474],
	charcutería: [455],
	mercado: [493],
	farmacia: [208],
	gasolinera: [596],
	cargador: [593, 594],
	restaurante: [570],
	'comida rápida': [566],
	cafetería: [564, 435],
	bar: [561, 569],
	heladería: [568],
	cajero: [191],
	banco: [192],
	aseos: [179],
	aparcamiento: [601],
	taller: [590],
	hotel: [108, 106, 107, 109],
	hospital: [206, 202],
	estanco: [523],
	'área de picnic': [625, 281],
	mirador: [627]
} as const satisfies Record<string, readonly number[]>;

export type PoiKind = keyof typeof POI_KINDS;

export const isPoiKind = (value: unknown): value is PoiKind =>
	typeof value === 'string' && Object.hasOwn(POI_KINDS, value);

/** openpoiservice's largest circle around a point, in metres. */
export const POI_RADIUS_METRES = 2000;

export interface FoundPlace {
	/** As OpenStreetMap names it; without one, its kind and a number: «Panadería 2». */
	name: string;
	at: LngLat;
	/** Metres from the point searched around. */
	distance: number;
	/** OpenStreetMap's opening hours, as they are: «Mo-Sa 08:00-14:00». */
	hours: string | null;
}

type PoiFeature = {
	geometry?: { coordinates?: number[] };
	properties?: { distance?: number; osm_tags?: Record<string, string> };
};

/** The places found, nearest first, at most `count`; two with the same name, the nearer one. */
export function poisFromOrs(body: unknown, kind: PoiKind, count = 5): FoundPlace[] {
	const features = ((body as { features?: unknown[] } | null)?.features ?? []) as PoiFeature[];
	const found = features
		.flatMap((f) => {
			const [lon, lat] = f.geometry?.coordinates ?? [];
			if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
			const tags = f.properties?.osm_tags ?? {};
			return [
				{
					name: (tags.name ?? tags.brand ?? '').trim(),
					at: [lon, lat] as LngLat,
					distance: f.properties?.distance ?? 0,
					hours: tags.opening_hours?.trim() || null
				}
			];
		})
		.sort((a, b) => a.distance - b.distance);
	const seen = new Set<string>();
	const kindName = kind.charAt(0).toUpperCase() + kind.slice(1);
	let unnamed = 0;
	return found
		.filter((p) => {
			if (!p.name) return true;
			const key = fold(p.name);
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, count)
		.map((p) => (p.name ? p : { ...p, name: `${kindName} ${++unnamed}` }));
}
