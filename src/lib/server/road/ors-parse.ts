import type { LngLat, Place, Route } from '#lib/road.ts';

/**
 * openrouteservice's answers, as ours (#78): apart from the requests, to be tested with answers of
 * its shape (https://giscience.github.io/openrouteservice/api-reference/).
 */

/** A geocoding answer (GeoJSON): the places with a name and a point. */
export function placesFromOrs(body: unknown): Place[] {
	const features = (body as { features?: unknown[] } | null)?.features ?? [];
	return features.flatMap((f) => {
		const feature = f as {
			properties?: { label?: string };
			geometry?: { coordinates?: number[] };
		};
		const [lon, lat] = feature.geometry?.coordinates ?? [];
		return feature.properties?.label && Number.isFinite(lon) && Number.isFinite(lat)
			? [{ label: feature.properties.label, at: [lon, lat] as LngLat }]
			: [];
	});
}

interface OrsStep {
	distance: number;
	type: number;
	instruction: string;
	way_points: [number, number];
}

/** A directions answer (GeoJSON): its line, distance, time and steps; null without a route. */
export function routeFromOrs(body: unknown): Route | null {
	const feature = (body as { features?: unknown[] } | null)?.features?.[0] as
		| {
				geometry?: { coordinates?: LngLat[] };
				properties?: {
					summary?: { distance?: number; duration?: number };
					segments?: { steps?: OrsStep[] }[];
				};
		  }
		| undefined;
	const line = feature?.geometry?.coordinates ?? [];
	if (!line.length) return null;
	const summary = feature?.properties?.summary ?? {};
	const steps = (feature?.properties?.segments ?? []).flatMap((s) => s.steps ?? []);
	return {
		line,
		distance: summary.distance ?? 0,
		duration: summary.duration ?? 0,
		steps: steps.map((s) => ({
			instruction: s.instruction,
			distance: s.distance,
			type: s.type,
			at: line[s.way_points[0]] ?? line[0]!
		}))
	};
}
