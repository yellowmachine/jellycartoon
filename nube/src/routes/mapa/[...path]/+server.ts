import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAP_DIR } from '$app/env/private';
import { fileResponse } from 'comun/server/file-response.ts';

const TYPES: Record<string, string> = {
	'.pmtiles': 'application/octet-stream',
	'.pbf': 'application/x-protobuf',
	'.json': 'application/json',
	'.png': 'image/png'
};

const mapDir = path.resolve(MAP_DIR);

/**
 * The road mode's map (#253; jellycartoon's #78), from MAP_DIR (scripts/mapa.sh): the PMTiles,
 * read by pieces (Range) as the map moves, and its style's fonts and icons.
 */
export const GET: RequestHandler = ({ params, request }) => {
	const file = path.resolve(mapDir, params.path);
	const type = TYPES[path.extname(file)];
	// Inside the map's folder only.
	if (!type || !file.startsWith(mapDir + path.sep)) error(404, 'No encontrado');
	// The map, asked every time if it changed: its pieces from before an update, mixed with the
	// new file's, would be nonsense. Its fonts and icons, a day.
	const cache = type === TYPES['.pmtiles'] ? 'private, no-cache' : 'private, max-age=86400';
	return fileResponse(request, file, type, cache);
};
