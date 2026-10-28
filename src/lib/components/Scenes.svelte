<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { poll } from '#lib/poll.ts';
	import { formatDuration } from 'comun/format.ts';
	import { sceneFrameAt, sceneNames, type Chapter, type SceneName } from '#lib/scenes.ts';
	import FrameViewer from './FrameViewer.svelte';

	interface Props {
		movieId: number;
		durationSec: number;
		chapters: Chapter[];
		names: SceneName[] | null;
		/** Seen: the names, which tell the plot, show without asking. */
		completed: boolean;
		mpv: boolean;
		/** There is an OpenRouter key and the film has its info. */
		canName: boolean;
		naming: { naming: boolean; failed: string | null };
	}

	let { movieId, durationSec, chapters, names, completed, mpv, canName, naming }: Props = $props();

	let shown = $state(false);
	let revealed = $state(false);
	let viewer = $state<FrameViewer>();

	const named = $derived(sceneNames(chapters, names));
	const hasNames = $derived(named.some(Boolean));
	const visible = $derived(hasNames && (completed || revealed));
	const moments = $derived(
		chapters.map((c, i) => ({
			at: sceneFrameAt(chapters, i, durationSec),
			playAt: Math.floor(c.startSec),
			caption: visible ? named[i] : null
		}))
	);
	const time = (seconds: number) => formatDuration(seconds) || '0:00';

	// Until the AI is done.
	$effect(() => {
		if (!naming.naming) return;
		return poll(invalidateAll, 3000);
	});

	const button = 'rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800';
</script>

<section class="mt-8">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="font-semibold">Escenas</h2>
		<span class="text-sm text-zinc-400">{chapters.length} capítulos del disco</span>
		{#if !shown}
			<button onclick={() => (shown = true)} class={button}>Ver escenas</button>
		{/if}
	</div>

	{#if naming.naming}
		<p class="mb-3 text-sm text-amber-400">
			La IA está mirando un fotograma de cada escena: tarda un minuto o dos.
		</p>
	{:else if canName && !hasNames}
		<form method="post" action="?/nameScenes" use:enhance class="mb-3">
			<button class={button}>Ponerles nombre con la IA</button>
		</form>
	{/if}
	{#if naming.failed}
		<p class="mb-3 text-sm text-red-400">No se pudieron nombrar: {naming.failed}</p>
	{/if}
	{#if hasNames && !visible}
		<button onclick={() => (revealed = true)} class="{button} mb-3">
			Mostrar los nombres (cuentan la película)
		</button>
	{/if}

	{#if shown}
		<ul
			class={[
				'grid gap-x-2 gap-y-3',
				visible ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-4 gap-x-1 sm:grid-cols-5 sm:gap-x-2'
			]}
		>
			{#each moments as moment, i (moment.playAt)}
				<li class="min-w-0">
					<button
						onclick={() => viewer?.open(i)}
						class="block aspect-video w-full overflow-hidden rounded bg-zinc-800 hover:opacity-80"
						aria-label="Escena {i + 1}, en {time(moment.playAt)}"
					>
						<img
							src="/api/movie-frame/{movieId}/{moment.at}"
							alt=""
							class="h-full w-full object-cover"
							loading="lazy"
						/>
					</button>
					<p class="mt-1 text-xs text-zinc-400 tabular-nums">{time(moment.playAt)}</p>
					{#if moment.caption}
						<p class="line-clamp-2 text-sm leading-snug" title={moment.caption}>
							{moment.caption}
						</p>
					{/if}
				</li>
			{/each}
		</ul>
		<div class="mt-2 text-xs text-zinc-500">
			Pulsa una para verla en grande y empezar desde ella.
			{#if hasNames && canName && !naming.naming}
				<form method="post" action="?/nameScenes" use:enhance class="inline">
					<button class="hover:text-white hover:underline">Volver a nombrarlas</button>
				</form>
			{/if}
		</div>
	{/if}
</section>

<FrameViewer bind:this={viewer} {movieId} {mpv} {moments} />
