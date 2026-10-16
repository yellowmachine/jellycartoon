<script lang="ts">
	import { enhance } from '$app/forms';
	import { thumbUrl } from '#lib/thumb.svelte.ts';

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
</script>

<form method="post" {action} use:enhance>
	<input type="hidden" name="id" value={id} />
	<button class="group block w-full rounded-lg text-left">
		<div class="relative aspect-video overflow-hidden rounded-lg bg-zinc-800">
			<img src={thumbUrl(id)} alt="" class="h-full w-full object-cover" />
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
