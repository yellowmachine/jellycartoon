import type { LngLat } from 'comun/road.ts';
import { fold } from 'comun/music.ts';
import { alongLine, locate } from 'comun/road-guide.ts';

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
	/** Metres from the point searched around; along the route, from where we are. */
	distance: number;
	/** Along the route: metres from the road to it, the way off it. */
	off?: number;
	/** OpenStreetMap's opening hours, as they are: «Mo-Sa 08:00-14:00». */
	hours: string | null;
}

type PoiFeature = {
	geometry?: { coordinates?: number[] };
	properties?: { distance?: number; osm_tags?: Record<string, string> };
};

/** Each place answered, with OpenStreetMap's name (or none, '') and its distance as it comes. */
function rawPois(body: unknown): FoundPlace[] {
	const features = ((body as { features?: unknown[] } | null)?.features ?? []) as PoiFeature[];
	return features.flatMap((f) => {
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
	});
}

const kindName = (kind: PoiKind) => kind.charAt(0).toUpperCase() + kind.slice(1);

/** The places found, nearest first, at most `count`; two with the same name, the nearer one. */
export function poisFromOrs(body: unknown, kind: PoiKind, count = 5): FoundPlace[] {
	const found = rawPois(body).sort((a, b) => a.distance - b.distance);
	const seen = new Set<string>();
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
		.map((p) => (p.name ? p : { ...p, name: `${kindName(kind)} ${++unnamed}` }));
}

/** Along the route ahead, its line cut in stretches this long: each, a search of its own. */
export const ALONG_STRETCH_METRES = 30_000;
/** How far from the road, each side: what is by it, not in the next town. */
export const ALONG_BUFFER_METRES = 500;

/**
 * `line` (the route ahead, from where we are) in stretches of about `metres`, each sharing its
 * last point with the next, up to `upTo` metres: openpoiservice takes 50 km² at most.
 */
export function stretches(line: LngLat[], upTo: number, metres = ALONG_STRETCH_METRES): LngLat[][] {
	const along = alongLine(line);
	const out: LngLat[][] = [];
	let current: LngLat[] = line.slice(0, 1);
	let start = 0;
	for (let i = 1; i < line.length; i++) {
		current.push(line[i]!);
		const last = along[i]! >= upTo || i === line.length - 1;
		if (along[i]! - start < metres && !last) continue;
		out.push(current);
		if (last) break;
		current = [line[i]!];
		start = along[i]!;
	}
	return out;
}

/**
 * The places found along the route ahead (`line`, from where we are), the first we come to first,
 * at most `count`: their `distance` along it and how far `off` the road. Without a name, «Gasolinera
 * 1»; a name more than once (Repsol), «Repsol 2» after the first, to tell them apart.
 */
export function poisAlong(bodies: unknown[], line: LngLat[], kind: PoiKind, count = 5) {
	const along = alongLine(line);
	const seen = new Set<string>();
	const found = bodies
		.flatMap(rawPois)
		.map((p) => {
			const where = locate(line, along, p.at);
			return { ...p, distance: where.along, off: where.off };
		})
		.sort((a, b) => a.distance - b.distance)
		// The same place from two stretches (where they meet).
		.filter((p) => {
			const key = p.at.join(',');
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.slice(0, count);
	const times = new Map<string, number>();
	return found.map((p) => {
		const name = p.name || kindName(kind);
		const n = (times.get(fold(name)) ?? 0) + 1;
		times.set(fold(name), n);
		return { ...p, name: p.name && n === 1 ? name : `${name} ${n}` };
	});
}
