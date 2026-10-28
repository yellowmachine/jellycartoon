<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatDuration } from 'comun/format.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';

	/**
	 * An episode as its series' page shows it, as a link to watch it: thumbnail with how far it
	 * was watched, the series and its number, its title and length.
	 */

	let {
		episode,
		label,
		preview
	}: {
		episode: {
			id: number;
			seriesTitle: string;
			season: number;
			number: number;
			title: string;
			durationSec: number | null;
			positionSec: number | null;
			completed: boolean | null;
		};
		/** Above it, e.g. «A continuación». */
		label?: string;
		/** Over its thumbnail on hover: the house's moving preview (EpisodePreview), where there is one. */
		preview?: Snippet<[{ id: number; durationSec: number | null }]>;
	} = $props();
</script>

<a href="/watch/{episode.id}" class="group block rounded-md hover:bg-zinc-900">
	{#if label}
		<p class="mb-1 text-xs tracking-wide text-zinc-400 uppercase">{label}</p>
	{/if}
	<div class="relative aspect-video overflow-hidden rounded bg-zinc-800">
		<img
			src={thumbUrl(episode.id)}
			alt=""
			loading="lazy"
			class="h-full w-full object-cover transition group-hover:scale-105"
		/>
		{@render preview?.({ id: episode.id, durationSec: episode.durationSec })}
		{#if episode.completed}
			<span
				class="absolute top-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
				>✓ Visto</span
			>
		{/if}
		<!-- A watched episode has its position reset to 0 (next time starts over): full bar. -->
		{#if (episode.completed || episode.positionSec) && episode.durationSec}
			<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
				<div
					class="h-full bg-amber-400"
					style:width="{episode.completed
						? 100
						: ((episode.positionSec ?? 0) / episode.durationSec) * 100}%"
				></div>
			</div>
		{/if}
	</div>
	<p class="mt-1.5 line-clamp-2 text-sm">{episode.title}</p>
	<p class="truncate text-xs text-zinc-400">
		{episode.seriesTitle} · T{episode.season} E{episode.number}{episode.durationSec
			? ` · ${formatDuration(episode.durationSec)}`
			: ''}
	</p>
</a>
