// MapLibre's worker, bundled with what it imports, as Vite does workers:
// https://vite.dev/guide/features.html#import-with-query-suffixes
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { StyleSpecification } from 'maplibre-gl';

/**
 * The app's own map (#78, #81): Spain's served from DATA_DIR/mapa (scripts/mapa.sh), shown with
 * MapLibre (https://maplibre.org) in Protomaps' style, light or dark, its fonts and icons from the
 * app too. Loaded only where a map is shown; the PMTiles protocol, once for the whole page.
 */

let protocol: import('pmtiles').Protocol | null = null;

export async function loadOurMap() {
	const [maplibregl, { Protocol, PMTiles }, { layers, namedFlavor }] = await Promise.all([
		import('maplibre-gl'),
		import('pmtiles'),
		import('@protomaps/basemaps')
	]);
	maplibregl.setWorkerUrl(workerUrl);
	const origin = location.origin;
	const url = `${origin}/mapa/espana.pmtiles`;
	if (!protocol) {
		protocol = new Protocol();
		maplibregl.addProtocol('pmtiles', protocol.tile);
	}
	const archive = new PMTiles(url);
	protocol.add(archive);
	// Where the map is, to start there; null, it cannot be opened.
	const header = await archive.getHeader().catch(() => null);

	const styleFor = (light: boolean): StyleSpecification => ({
		version: 8,
		glyphs: `${origin}/mapa/fonts/{fontstack}/{range}.pbf`,
		sprite: `${origin}/mapa/sprites/v4/${light ? 'light' : 'dark'}`,
		sources: {
			protomaps: {
				type: 'vector',
				url: `pmtiles://${url}`,
				attribution:
					'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>'
			}
		},
		layers: layers('protomaps', namedFlavor(light ? 'light' : 'dark'), { lang: 'es' })
	});
	return { maplibregl, header, styleFor };
}
