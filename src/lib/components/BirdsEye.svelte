<script lang="ts">
	import { frameTimes } from '#lib/birds-eye.ts';
	import { formatDuration } from '#lib/format.ts';
	import FrameViewer from './FrameViewer.svelte';

	interface Props {
		movieId: number;
		durationSec: number;
		/** Whether «Ver desde aquí» can play it on the host's screen. */
		mpv: boolean;
	}

	let { movieId, durationSec, mpv }: Props = $props();

	let shown = $state(false);
	let viewer = $state<FrameViewer>();

	const times = $derived(frameTimes(durationSec));

	const button = 'rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800';
</script>

<section class="mt-8">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="font-semibold">Vista de pájaro</h2>
		{#if !shown}
			<button onclick={() => (shown = true)} class={button}>
				Ver {times.length} fotogramas
			</button>
		{/if}
	</div>

	{#if shown}
		<!-- A contact sheet: the whole film on one screen, also on a phone. -->
		<ul class="grid grid-cols-4 gap-1 sm:grid-cols-5 sm:gap-2">
			{#each times as at, i (at)}
				<li>
					<button
						onclick={() => viewer?.open(i)}
						class="block aspect-video w-full overflow-hidden rounded bg-zinc-800 hover:opacity-80"
						aria-label="Fotograma en {formatDuration(at)}"
					>
						<img
							src="/api/movie-frame/{movieId}/{at}"
							alt=""
							title={formatDuration(at)}
							class="h-full w-full object-cover"
						/>
					</button>
				</li>
			{/each}
		</ul>
		<p class="mt-2 text-xs text-zinc-500">
			Pulsa uno para verlo en grande. Se sacan del fichero al pedirlos y tardan unos segundos.
		</p>
	{/if}
</section>

<FrameViewer bind:this={viewer} {movieId} {mpv} moments={times.map((at) => ({ at, playAt: at }))} />
