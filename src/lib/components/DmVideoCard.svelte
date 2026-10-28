<script lang="ts">
	import { formatDuration } from 'comun/format.ts';

	/** A Dailymotion video in a list (#66): its picture, its title and how much was watched. */
	let {
		video,
		positionSec = 0,
		completed = false
	}: {
		video: {
			id: string;
			title: string;
			owner: string;
			durationSec: number | null;
			thumbnail: string | null;
		};
		positionSec?: number;
		completed?: boolean;
	} = $props();
</script>

<a href="/dailymotion/ver/{video.id}" class="group block rounded-md p-1 hover:bg-zinc-900">
	<div class="relative aspect-video overflow-hidden rounded bg-zinc-800">
		{#if video.thumbnail}
			<img
				src={video.thumbnail}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				class="h-full w-full object-cover"
			/>
		{/if}
		{#if completed}
			<span
				class="absolute top-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
				>✓ Visto</span
			>
		{/if}
		{#if video.durationSec}
			<span class="absolute right-1 bottom-1.5 rounded bg-zinc-950/80 px-1 text-xs"
				>{formatDuration(video.durationSec)}</span
			>
		{/if}
		{#if !completed && positionSec > 0 && video.durationSec}
			<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
				<div
					class="h-full bg-amber-400"
					style:width="{Math.min(100, (positionSec / video.durationSec) * 100)}%"
				></div>
			</div>
		{/if}
	</div>
	<p class="mt-1 line-clamp-2 text-sm group-hover:text-white">{video.title}</p>
	<p class="truncate text-xs text-zinc-500">{video.owner}</p>
</a>
