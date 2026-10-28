import path from 'node:path';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAP_DIR } from '$app/env/private';
import { fileResponse } from 'comun/server/file-response.ts';
import { kitchenOf } from '#lib/server/fridge.ts';
import { familyDir } from '#lib/server/trips/route-maps.ts';

const TYPES: Record<string, string> = {
	'.pmtiles': 'application/octet-stream',
	'.pbf': 'application/x-protobuf',
	'.json': 'application/json',
	'.png': 'image/png'
};

const mapDir = path.resolve(MAP_DIR);
const STRIPS = 'recorridos/';

/**
 * The road mode's map (#253; jellycartoon's #78), from MAP_DIR (scripts/mapa.sh): the PMTiles,
 * read by pieces (Range) as the map moves, and its style's fonts and icons. And under
 * /mapa/recorridos/<family>/, the strips cut around routes for devices without coverage (#164):
 * only the family's own.
 */
export const GET: RequestHandler = async ({ params, request, locals }) => {
	let dir = mapDir;
	let wanted = params.path;
	if (wanted.startsWith(STRIPS)) {
		dir = familyDir((await kitchenOf(locals.user!.id)).familyId);
		wanted = wanted.slice(STRIPS.length).split('/').slice(1).join('/');
		if (!params.path.startsWith(`${STRIPS}${path.basename(dir)}/`)) error(404, 'No encontrado');
	}
	const file = path.resolve(dir, wanted);
	const type = TYPES[path.extname(file)];
	// Inside its folder only.
	if (!type || !file.startsWith(dir + path.sep)) error(404, 'No encontrado');
	// The map, asked every time if it changed: its pieces from before an update, mixed with the
	// new file's, would be nonsense. Its fonts and icons, a day.
	const cache = type === TYPES['.pmtiles'] ? 'private, no-cache' : 'private, max-age=86400';
	return fileResponse(request, file, type, cache);
};
