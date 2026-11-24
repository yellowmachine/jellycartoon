import { mixed, type MusicTrack } from 'comun/music.ts';
import { asTrack, type OwnTrackRow } from '#lib/own-music.ts';
import { withFamily } from './family.ts';
import { ownCatalog } from './own-music.ts';
import { ownPlaylistOf } from './own-music-lists.ts';

/**
 * The road mode's music from the family's own bucket (#534), as it asks for it (`?de=propia`): each
 * track with its type, for the browser to leave out what it does not play.
 */
export type RoadTrack = MusicTrack & { mime?: string };

/** At most, in «Todo aleatorio»: as Música's. */
const SHUFFLED = 500;

export const isOwn = (url: URL) => url.searchParams.get('de') === 'propia';

const familyOf = (userId: string) => withFamily(userId, async (_, m) => m.familyId);

const roadTrack = (t: OwnTrackRow, a: Parameters<typeof asTrack>[1]): RoadTrack => ({
	...asTrack(t, a),
	mime: t.mime
});

/** An album's tracks, in order; none if it is not the family's. */
export async function ownAlbumTracks(userId: string, id: number) {
	const album = (await ownCatalog(await familyOf(userId))).find((a) => a.id === id);
	return album ? album.tracks.map((t) => roadTrack(t, album)) : [];
}

/** Of all of it, in random order. */
export async function ownRandomTracks(userId: string) {
	const all = (await ownCatalog(await familyOf(userId))).flatMap((a) =>
		a.tracks.map((t) => roadTrack(t, a))
	);
	return mixed(all).slice(0, SHUFFLED);
}

/** A playlist's tracks, in order; none if it is not the family's. */
export async function ownListTracks(userId: string, id: number) {
	const list = await ownPlaylistOf(await familyOf(userId), id);
	return list ? list.items.map((i) => roadTrack(i.track, i.album)) : [];
}
