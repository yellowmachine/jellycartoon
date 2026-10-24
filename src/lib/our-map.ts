// MapLibre's worker, bundled with what it imports, as Vite does workers:
// https://vite.dev/guide/features.html#import-with-query-suffixes
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { StyleSpecification } from 'maplibre-gl';
import type { PMTiles } from 'pmtiles';

/**
 * The app's own map (#78, #81): Spain's served from DATA_DIR/mapa (scripts/mapa.sh), shown with
 * MapLibre (https://maplibre.org) in Protomaps' style, light or dark, its fonts and icons from the
 * app too. Loaded only where a map is shown.
 *
 * On a device that keeps routes' maps (#164), each tile is looked for in them first, and only then
 * asked of the server: along those routes, the map does without coverage. Their fonts and icons,
 * kept in the browser's cache once used (and when a route's map is downloaded).
 */

/** Where each tile is looked for, in order: the device's routes' maps, then Spain's. */
let archives: PMTiles[] = [];
let registered = false;

/** `ourmap://{z}/{x}/{y}`: the first that has it. */
const TILES = 'ourmap';
/** `ourmapfile://fonts/…`, `ourmapfile://sprites/…`: kept for when there is no coverage. */
const FILES = 'ourmapfile';
const CACHE = 'jellycartoon-mapa';

/** From the cache first; asked once, and kept. */
async function cachedFile(path: string) {
	const url = `${location.origin}/mapa/${path}`;
	const cache = await caches.open(CACHE);
	const kept = await cache.match(url);
	if (kept) return kept;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	await cache.put(url, res.clone());
	return res;
}

export async function loadOurMap() {
	const [maplibregl, { PMTiles }, { layers, namedFlavor }, { routeMaps }] = await Promise.all([
		import('maplibre-gl'),
		import('pmtiles'),
		import('@protomaps/basemaps'),
		import('#lib/route-maps.svelte.ts')
	]);
	maplibregl.setWorkerUrl(workerUrl);
	const origin = location.origin;
	const spain = new PMTiles(`${origin}/mapa/espana.pmtiles`);
	const held = await routeMaps.archives().catch(() => []);
	archives = [...held, spain];
	if (!registered) {
		registered = true;
		maplibregl.addProtocol(TILES, async ({ url }, abort) => {
			const [z, x, y] = url
				.slice(TILES.length + 3)
				.split('/')
				.map(Number) as [number, number, number];
			for (const archive of archives) {
				const tile = await archive.getZxy(z, x, y, abort.signal).catch((problem) => {
					// Spain's, without coverage: the tile is asked again later.
					if (archive === archives.at(-1)) throw problem;
				});
				if (tile) return { data: tile.data };
			}
			return { data: new Uint8Array() };
		});
		maplibregl.addProtocol(FILES, async ({ url, type }) => {
			const res = await cachedFile(url.slice(FILES.length + 3));
			return { data: type === 'json' ? await res.json() : await res.arrayBuffer() };
		});
	}
	// Where the map is, to start there; without coverage, from a route's map. Null: it cannot be
	// opened.
	let header = await spain.getHeader().catch(() => null);
	for (const archive of held) header ??= await archive.getHeader().catch(() => null);
	// The fonts and icons kept only where routes' maps are: elsewhere, as ever.
	const files = held.length || routeMaps.device ? `${FILES}://` : `${origin}/mapa/`;

	const styleFor = (light: boolean): StyleSpecification => ({
		version: 8,
		glyphs: `${files}fonts/{fontstack}/{range}.pbf`,
		sprite: `${files}sprites/v4/${light ? 'light' : 'dark'}`,
		sources: {
			protomaps: {
				type: 'vector',
				tiles: [`${TILES}://{z}/{x}/{y}`],
				minzoom: header?.minZoom ?? 0,
				maxzoom: header?.maxZoom ?? 15,
				attribution:
					'<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">colaboradores de OpenStreetMap</a>'
			}
		},
		layers: layers('protomaps', namedFlavor(light ? 'light' : 'dark'), { lang: 'es' })
	});
	return { maplibregl, header, styleFor };
}

/** The fonts' pieces for Spanish (Latin, its accents, «», —, €) and the icons, light and dark. */
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
const RANGES = ['0-255', '256-511', '8192-8447'];

/** Kept now, with a route's map (#164): the map shows its names without coverage. */
export async function keepMapFiles() {
	const paths = [
		...FONTS.flatMap((font) => RANGES.map((range) => `fonts/${font}/${range}.pbf`)),
		...['light', 'dark'].flatMap((flavor) =>
			['', '@2x'].flatMap((ratio) =>
				['json', 'png'].map((ext) => `sprites/v4/${flavor}${ratio}.${ext}`)
			)
		)
	];
	await Promise.all(paths.map((p) => cachedFile(p).catch(() => {})));
}
