<script lang="ts">
	import { enhance } from '$app/forms';
	import { music } from 'comun/music-player.svelte.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';
	import EpisodePreview from './EpisodePreview.svelte';

	/** An episode on the TV view: OK plays it in the living room. */
	let {
		id,
		heading,
		detail,
		positionSec = null,
		durationSec = null,
		completed = false,
		action = '?/episode'
	}: {
		id: number;
		heading: string;
		detail: string;
		positionSec?: number | null;
		durationSec?: number | null;
		completed?: boolean | null;
		action?: string;
	} = $props();

	/**
	 * A second OK while the first is on its way is left out. Not disabled: the button would lose the
	 * focus, and the remote with it.
	 */
	let sending = false;
</script>

<!-- The radio, if it is on, stops: the episode is what is watched now. -->
<form
	method="post"
	{action}
	use:enhance={({ cancel }) => {
		if (sending) return cancel();
		sending = true;
		music.stop();
		return async ({ update }) => {
			await update();
			sending = false;
		};
	}}
>
	<input type="hidden" name="id" value={id} />
	<button
		class="group block w-full rounded-lg text-left transition-transform duration-150 focus-visible:scale-105"
	>
		<div class="relative aspect-video overflow-hidden rounded-lg bg-zinc-800">
			<img src={thumbUrl(id)} alt="" class="h-full w-full object-cover" />
			<EpisodePreview {id} {durationSec} />
			{#if completed}
				<span class="absolute top-2 right-2 rounded-full bg-zinc-950/80 px-3 py-1 text-lg"
					>✓ Visto</span
				>
			{:else if positionSec}
				<div class="absolute inset-x-0 bottom-0 h-2 bg-zinc-700">
					<div
						class="h-full bg-amber-400"
						style:width="{(positionSec / (durationSec || 1)) * 100}%"
					></div>
				</div>
			{/if}
		</div>
		<p class="mt-2 truncate font-semibold group-focus-visible:text-amber-400">{heading}</p>
		<p class="truncate text-xl text-zinc-400">{detail}</p>
	</button>
</form>
