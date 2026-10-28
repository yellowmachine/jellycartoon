<script lang="ts">
	import { formatDuration } from '../format.ts';
	import type { MusicTrack } from '../music.ts';
	import { music } from '../music-player.svelte.ts';
	import AddToPlaylist from './AddToPlaylist.svelte';
	import AlbumCover from './AlbumCover.svelte';

	interface Props {
		/** From different albums: each one with its cover, artist and album. */
		tracks: MusicTrack[];
		/** Unique on the page, for the playlist menus. */
		key: string;
		playlists: { id: number; name: string }[];
		onplay: (track: MusicTrack, index: number) => void;
	}

	let { tracks, key, playlists, onplay }: Props = $props();
</script>

<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
	{#each tracks as t, i (t.id)}
		<li class="flex items-center pr-1">
			<button
				class={[
					'flex min-w-0 flex-1 items-center gap-3 p-2 text-left hover:bg-zinc-900',
					music.current?.id === t.id && 'text-amber-400'
				]}
				onclick={() => onplay(t, i)}
			>
				<AlbumCover album={{ id: t.albumId, hasCover: t.hasCover }} class="w-10 shrink-0 rounded" />
				<span class="min-w-0 flex-1">
					<span class="block truncate text-sm">{t.title}</span>
					<span class="block truncate text-xs text-zinc-400">{t.artist} · {t.album}</span>
				</span>
				<span class="text-xs text-zinc-500">{formatDuration(t.durationSec)}</span>
			</button>
			<AddToPlaylist trackId={t.id} key="{key}-{t.id}" {playlists} />
		</li>
	{/each}
</ol>
