import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { album, track } from '#lib/server/db/schema.ts';
import { probe } from '#lib/server/library/ffmpeg.ts';
import { musicFile } from '#lib/server/library/paths.ts';
import { log } from '#lib/server/log.ts';
import { findCovers } from './covers.ts';
import { wakeOpus } from './opus.ts';
import { musicProgress } from './status.ts';
import { albumArtist, discIdFromToc, normalizeTags, trackNumber } from './tags.ts';

let running: Promise<void> | null = null;

/**
 * Reads the tags of the tracks the scan found, one at a time in the background, and then looks
 * for the covers of the albums without one. Resolves when there is nothing left; then their Opus
 * copies are made, on their own.
 */
export function wakeMusicCatalog() {
	running ??= readPending()
		.then(findCovers)
		.catch((error) => log.error('música', 'Fallo inesperado al catalogar la música', { error }))
		.finally(() => {
			running = null;
			musicProgress.phase = 'idle';
			void wakeOpus();
		});
	return running;
}

async function readPending() {
	musicProgress.phase = 'reading';
	// Said once, when done: a line per track would fill the Registro.
	const read = { ready: 0, ignored: 0 };
	for (;;) {
		const [next] = await db
			.select({ id: track.id, path: track.path })
			.from(track)
			.where(and(eq(track.status, 'pending'), eq(track.missing, false)))
			.limit(1);
		if (!next) {
			if (read.ready || read.ignored)
				log.info(
					'música',
					`Leídas las etiquetas de ${read.ready} pistas${read.ignored ? ` (${read.ignored} sin álbum, apartadas)` : ''}`,
					{ ...read }
				);
			return;
		}

		try {
			// Not the worker's: it must not freeze when the conversion queue is paused.
			const info = await probe(musicFile(next.path), undefined, false);
			const tags = normalizeTags(info.format.tags);
			if (!tags.album) {
				await db
					.update(track)
					.set({ status: 'ignored', albumId: null, error: null })
					.where(eq(track.id, next.id));
				read.ignored++;
				continue;
			}

			// Each folder is an album; each disc of a double album has its own.
			const folder = path.dirname(next.path);
			const [{ id: albumId }] = await db
				.insert(album)
				.values({ folder, title: tags.album, artist: tags.albumartist ?? tags.artist ?? '' })
				.onConflictDoUpdate({ target: album.folder, set: { folder } })
				.returning({ id: album.id });
			await db
				.update(track)
				.set({
					status: 'ready',
					error: null,
					albumId,
					title: tags.title ?? path.parse(next.path).name,
					artist: tags.artist ?? null,
					albumArtist: tags.albumartist ?? null,
					albumTitle: tags.album,
					number: trackNumber(tags.tracknumber ?? tags.track),
					durationSec: Number(info.format.duration) || null
				})
				.where(eq(track.id, next.id));
			await refreshAlbum(albumId, discIdFromToc(tags.cdtoc));
			read.ready++;
		} catch (error) {
			await db
				.update(track)
				.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
				.where(eq(track.id, next.id));
			log.error('música', `No se pudieron leer las etiquetas de ${next.path}`, {
				trackId: next.id,
				error
			});
		}
	}
}

/** Title and artist from its tracks so far: the title is the first track's ALBUM tag. */
async function refreshAlbum(albumId: number, discId: string | null) {
	const tracks = await db
		.select({
			artist: track.artist,
			albumArtist: track.albumArtist,
			albumTitle: track.albumTitle,
			number: track.number
		})
		.from(track)
		.where(and(eq(track.albumId, albumId), eq(track.status, 'ready')));
	const first = tracks.toSorted((a, b) => (a.number ?? 999) - (b.number ?? 999))[0];
	await db
		.update(album)
		.set({
			title: first?.albumTitle ?? '',
			artist: albumArtist(tracks),
			...(discId ? { discId } : {})
		})
		.where(eq(album.id, albumId));
}
