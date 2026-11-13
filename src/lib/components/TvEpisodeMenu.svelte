<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { music } from 'comun/music-player.svelte.ts';

	/**
	 * An episode's options on the TV view, from the remote's Menú key: start it over, watched or
	 * not, watched up to it. A modal <dialog>: the page behind is inert, so the arrows stay in it,
	 * and closing it gives the focus back to the episode. Opened as a step in the history
	 * (page.state.episodeMenu), so the remote's Back closes it; Escape too.
	 */
	let {
		heading,
		id,
		started,
		completed,
		upTo
	}: {
		heading: string;
		id: number;
		/** Begun and not finished: «Ver desde el principio». */
		started: boolean;
		completed: boolean;
		/** Some before it not watched yet: «Marcar como vistos hasta aquí». */
		upTo: boolean;
	} = $props();

	let dialog: HTMLDialogElement;
	let sending = false;
	/** Its history step already taken back: once, or Back would leave the series too. */
	let left = false;

	onMount(() => {
		dialog.showModal();
		return () => {
			left = true;
			// Closed while still in the page, so the focus goes back to the episode.
			dialog.close();
		};
	});

	/** Done (or Escape): out of the history step, which closes it. */
	function close() {
		if (left) return;
		left = true;
		history.back();
	}

	const option =
		'rounded-2xl border-2 border-white/10 bg-zinc-900 px-8 py-4 text-left text-3xl font-semibold transition duration-150 focus-visible:scale-105 focus-visible:border-amber-400 focus-visible:bg-zinc-800';
</script>

{#snippet choice(action: string, label: string, fields: Record<string, string> = {})}
	<form
		method="post"
		{action}
		use:enhance={({ cancel }) => {
			if (sending) return cancel();
			sending = true;
			if (action === '?/episode') music.stop();
			return async ({ update }) => {
				await update();
				sending = false;
				close();
			};
		}}
	>
		<input type="hidden" name="id" value={id} />
		{#each Object.entries(fields) as [name, value] (name)}
			<input type="hidden" {name} {value} />
		{/each}
		<button class="{option} w-full">{label}</button>
	</form>
{/snippet}

<dialog
	bind:this={dialog}
	aria-label="Opciones del capítulo"
	class="m-auto w-full max-w-2xl bg-transparent p-0 text-zinc-100 backdrop:bg-zinc-950/80 backdrop:backdrop-blur-sm"
	oncancel={(e) => {
		e.preventDefault();
		close();
	}}
	onclose={close}
>
	<h2 class="mb-2 text-4xl font-bold">{heading}</h2>
	<p class="mb-8 text-xl text-zinc-400">Volver para cerrar</p>
	<div class="flex flex-col gap-3">
		{#if started && !completed}
			{@render choice('?/episode', 'Ver desde el principio', { from: 'start' })}
		{/if}
		{#if completed}
			{@render choice('?/watched', 'Marcar como no visto', { watched: 'false' })}
		{:else}
			{@render choice('?/watched', 'Marcar como visto', { watched: 'true' })}
		{/if}
		{#if upTo}
			{@render choice('?/watchedUpTo', 'Marcar como vistos hasta aquí')}
		{/if}
	</div>
</dialog>
