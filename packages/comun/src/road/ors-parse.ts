import type { LngLat, Place, Route } from 'comun/road.ts';
import type { Place as Town } from 'comun/weather.ts';

/**
 * openrouteservice's answers, as ours (#78): apart from the requests, to be tested with answers of
 * its shape (https://giscience.github.io/openrouteservice/api-reference/).
 */

/** A geocoding answer (GeoJSON): the places with a name and a point. */
export function placesFromOrs(body: unknown): Place[] {
	const features = (body as { features?: unknown[] } | null)?.features ?? [];
	// The same address from two of its sources (OpenStreetMap and OpenAddresses, a doorway): once,
	// the first. Two alike cannot be told apart to choose, and the lists key them by their label.
	const seen = new Set<string>();
	return features.flatMap((f) => {
		const feature = f as {
			properties?: { label?: string };
			geometry?: { coordinates?: number[] };
		};
		const label = feature.properties?.label;
		const [lon, lat] = feature.geometry?.coordinates ?? [];
		if (!label || seen.has(label) || !Number.isFinite(lon) || !Number.isFinite(lat)) return [];
		seen.add(label);
		return [{ label, at: [lon, lat] as LngLat }];
	});
}

/**
 * Towns and cities, as the weather's places (comun/weather.ts): with their province (Pelias's
 * `region`; its `macroregion`, the autonomous community, if it has none) and country, to tell one
 * Toledo from another.
 */
export function townsFromOrs(body: unknown): Town[] {
	const features = (body as { features?: unknown[] } | null)?.features ?? [];
	const seen = new Set<string>();
	return features.flatMap((f) => {
		const feature = f as {
			properties?: Record<string, unknown>;
			geometry?: { coordinates?: number[] };
		};
		const p = feature.properties ?? {};
		const text = (key: string) => (typeof p[key] === 'string' && p[key] ? String(p[key]) : null);
		const name = text('name');
		const [lon, lat] = feature.geometry?.coordinates ?? [];
		if (!name || !Number.isFinite(lon) || !Number.isFinite(lat)) return [];
		const town = {
			name,
			region: text('region') ?? text('macroregion') ?? text('county'),
			country: text('country'),
			lat,
			lon
		};
		const key = [town.name, town.region, town.country].join('|');
		if (seen.has(key)) return [];
		seen.add(key);
		return [town];
	});
}

const ORDINALS: Record<string, string> = {
	'1a': 'primera',
	'2a': 'segunda',
	'3a': 'tercera',
	'4a': 'cuarta',
	'5a': 'quinta',
	'6a': 'sexta',
	'7a': 'séptima',
	'8a': 'octava',
	'9a': 'novena',
	'10a': 'décima'
};

/** Its turns, as they come before a street's name. */
const TURNS =
	'a la izquierda|a la derecha|bastante a la izquierda|bastante a la derecha|ligeramente a la izquierda|ligeramente a la derecha|todo recto|atrás';

/**
 * Its Spanish (ors_es-ES.resources), as the app speaks: «tú», and as it sounds read aloud. Its
 * setting off is a walk, by car too («Camina hacia…»); its streets come after «a» («Gire a la
 * izquierda a Calle Real»); its exits are numbers («la 2a salida», read «dos a»).
 */
export function spokenSpanish(instruction: string) {
	return instruction
		.replace(/^Camina hacia/, 'Sal hacia')
		.replace(
			/^Entre en la rotonda y tome la (\d+a) salida a /,
			'Entra en la rotonda y toma la $1 salida hacia '
		)
		.replace(/^Entre en la rotonda y tome la/, 'Entra en la rotonda y toma la')
		.replace(/^Entre en la rotonda y salga a/, 'Entra en la rotonda y sal hacia')
		.replace(/^Entrar en la rotonda/, 'Entra en la rotonda')
		.replace(/^Haga una vuelta en U a /, 'Da la vuelta hacia ')
		.replace(/^Haga una vuelta en U/, 'Da la vuelta')
		.replace(new RegExp(`^(Gire|Siga) (${TURNS}) a `), '$1 $2 por ')
		.replace(/^Gire /, 'Gira ')
		.replace(/^Siga /, 'Sigue ')
		.replace(/^Llegar a su destino/, 'Llegas a tu destino')
		.replace(/^Llegar a /, 'Llegas a ')
		.replace(/, es recto$/, ', de frente')
		.replace(/\b(\d+a)\b/g, (n) => ORDINALS[n] ?? n);
}

interface OrsStep {
	distance: number;
	duration?: number;
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
	// One stretch per stop on the way (#151): each ends arriving and the next sets off; on the way,
	// neither is said, only at the start and the end.
	const segments = feature?.properties?.segments ?? [];
	const steps = segments.flatMap((s, i) =>
		(s.steps ?? []).filter(
			(step) => !(step.type === 10 && i < segments.length - 1) && !(step.type === 11 && i > 0)
		)
	);
	return {
		line,
		distance: summary.distance ?? 0,
		duration: summary.duration ?? 0,
		steps: steps.map((s) => ({
			instruction: spokenSpanish(s.instruction),
			distance: s.distance,
			duration: s.duration ?? 0,
			type: s.type,
			at: line[s.way_points[0]] ?? line[0]!,
			index: Math.min(s.way_points[0], line.length - 1)
		}))
	};
}
