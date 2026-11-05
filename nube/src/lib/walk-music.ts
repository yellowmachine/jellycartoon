import { music } from 'comun/music-player.svelte.ts';
import type { MusicTrack } from 'comun/music.ts';
import { askPass, useKept } from '#lib/music-pass.svelte.ts';
import { offlineMusic } from '#lib/offline-music.svelte.ts';

/**
 * A playlist put on when a walk starts (#416): from the device's disk what it carries, as the road
 * mode. Without the house, only those songs. Why it could not, if it could not.
 */
export async function playWalkList(id: number): Promise<string | null> {
	const away = await askPass();
	if (away) useKept();
	const kept = offlineMusic.lists.find((l) => l.id === id);
	let tracks: MusicTrack[];
	if (kept) tracks = away ? kept.tracks.filter((t) => offlineMusic.has(t.id)) : kept.tracks;
	else {
		if (away) return `Sin música: ${away}`;
		const res = await fetch(`/carretera/listas/${id}`).catch(() => null);
		if (!res?.ok) return 'Sin música: no se pudo cargar la lista';
		tracks = await res.json();
	}
	if (!tracks.length) return 'Sin música: la lista no tiene canciones aquí';
	music.play(tracks, 0);
	return null;
}
