import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cloudViewer } from '#lib/server/media-api.ts';
import {
	addToPlaylist,
	deletePlaylist,
	getPlaylist,
	moveInPlaylist,
	removeFromPlaylist,
	renamePlaylist
} from '#lib/server/music/playlists.ts';

/** The music API (#253): a playlist and its tracks, in order; `items`, with each one's place. */
export const GET: RequestHandler = async ({ request, params }) => {
	await cloudViewer(request);
	const playlist = await getPlaylist(Number(params.id));
	if (!playlist) error(404, 'Lista no encontrada');
	return json({
		playlist: {
			id: playlist.id,
			name: playlist.name,
			tracks: playlist.items.map((i) => i.track),
			items: playlist.items
		}
	});
};

/**
 * Changed from the cloud's Música, as from the house's: `{ action }`, `rename` (`name`), `add`
 * (`trackId`), `remove`, `up` or `down` (`itemId`).
 */
export const POST: RequestHandler = async ({ request, params }) => {
	await cloudViewer(request);
	const id = Number(params.id);
	const body = await request.json().catch(() => null);
	switch (body?.action) {
		case 'rename': {
			const name = String(body.name ?? '').trim();
			if (!name) error(400, 'El nombre no puede estar vacío');
			await renamePlaylist(id, name.slice(0, 100));
			break;
		}
		case 'add':
			if (!Number.isInteger(body.trackId)) error(400, 'Canción no válida');
			await addToPlaylist(id, body.trackId).catch(() => error(404, 'Esa lista ya no existe'));
			break;
		case 'remove':
		case 'up':
		case 'down': {
			const itemId = Number(body.itemId);
			if (!Number.isInteger(itemId)) error(400, 'Canción no válida');
			if (body.action === 'remove') await removeFromPlaylist(id, itemId);
			else await moveInPlaylist(id, itemId, body.action === 'up' ? -1 : 1);
			break;
		}
		default:
			error(400, 'Petición no válida');
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, params }) => {
	await cloudViewer(request);
	await deletePlaylist(Number(params.id));
	return json({ ok: true });
};
