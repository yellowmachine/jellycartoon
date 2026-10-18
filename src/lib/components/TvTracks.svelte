<script lang="ts">
	import { goto } from '$app/navigation';
	import MediaIcon from './MediaIcon.svelte';
	import SectionIcon from './SectionIcon.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { MusicTrack } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';

	/**
	 * An album's or a playlist's tracks on the TV view: on the TV's speakers, as the radio there,
	 * and then «Sonando», where the remote controls them.
	 */
	let { tracks, artists = false }: { tracks: MusicTrack[]; artists?: boolean } = $props();

	function play(start: number, shuffle = false) {
		music.setShuffle(shuffle);
		music.play(tracks, start);
		void goto('/tv/sonando');
	}
</script>

<div class="mb-10 flex gap-6">
	<button
		class="flex items-center gap-3 rounded-full bg-violet-500 px-8 py-4 text-3xl font-semibold text-zinc-950 transition duration-150 focus-visible:scale-110"
		onclick={() => play(0)}
	>
		<MediaIcon name="play" class="h-8 w-8" /> Reproducir
	</button>
	<button
		class="flex items-center gap-3 rounded-full bg-zinc-800 px-8 py-4 text-3xl font-semibold transition duration-150 focus-visible:scale-110"
		onclick={() => play(Math.floor(Math.random() * tracks.length), true)}
	>
		<MediaIcon name="shuffle" class="h-8 w-8" /> Aleatorio
	</button>
</div>

<ol class="space-y-2">
	{#each tracks as t, i (`${i}:${t.id}`)}
		{@const on = !music.radio && music.current?.id === t.id}
		<li>
			<!-- The one that is on: OK goes to its controls, instead of starting it again. -->
			<button
				class={[
					'flex w-full items-center gap-6 rounded-xl border-2 px-6 py-3 text-left transition duration-150 focus-visible:scale-[1.02]',
					on
						? 'border-violet-400 bg-violet-500/15'
						: 'border-transparent bg-zinc-900/80 focus-visible:border-white/30 focus-visible:bg-zinc-800'
				]}
				onclick={() => (on ? goto('/tv/sonando') : play(i))}
			>
				<span class="w-12 shrink-0 text-right text-zinc-500 tabular-nums">
					{#if on}
						<SectionIcon name="musica" class="ml-auto h-7 w-7 text-violet-300" />
					{:else}
						{artists ? i + 1 : (t.number ?? i + 1)}
					{/if}
				</span>
				<span class="min-w-0 flex-1">
					<span class={['block truncate', on && 'text-violet-300']}>{t.title}</span>
					{#if artists}
						<span class="block truncate text-xl text-zinc-400">{t.artist} · {t.album}</span>
					{/if}
				</span>
				<span class="shrink-0 text-xl text-zinc-500 tabular-nums"
					>{formatDuration(t.durationSec)}</span
				>
			</button>
		</li>
	{/each}
</ol>
