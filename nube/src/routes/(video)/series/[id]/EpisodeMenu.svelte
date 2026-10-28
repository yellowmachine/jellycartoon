<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import ActionMenu from 'comun/components/ActionMenu.svelte';
	import { menuItem } from 'comun/components/menu.ts';
	import { formatDuration } from 'comun/format.ts';
	import type { SeriesEpisode } from '#lib/server/series.ts';

	/**
	 * An episode's «…» (#253), as jellycartoon's, with what is for watching: going on or starting
	 * over, and watched or not. The rest (the living room, lists, renaming…) is at home.
	 */
	let { episode }: { episode: SeriesEpisode } = $props();

	// The player ignores the first seconds too: it starts over below that.
	const resumeAt = $derived(
		!episode.completed && episode.positionSec > 5 ? episode.positionSec : 0
	);

	const closeAfter =
		(close: () => void): SubmitFunction =>
		() =>
		async ({ update }) => {
			close();
			await update();
		};
</script>

{#snippet item(label: string)}
	<span class={menuItem}>{label}</span>
{/snippet}

<ActionMenu id="episode-menu-{episode.id}">
	{#snippet children(close)}
		{#if resumeAt}
			<a href="/watch/{episode.id}">{@render item(`Continuar desde ${formatDuration(resumeAt)}`)}</a
			>
		{/if}
		<a href="/watch/{episode.id}?t=0">{@render item('Empezar desde el principio')}</a>
		<hr class="my-1 border-zinc-800" />
		<form method="post" action="?/setWatched" use:enhance={closeAfter(close)}>
			<input type="hidden" name="id" value={episode.id} />
			<input type="hidden" name="watched" value={String(!episode.completed)} />
			<button class="w-full">
				{@render item(episode.completed ? 'Marcar como no visto' : 'Marcar como visto')}
			</button>
		</form>
	{/snippet}
</ActionMenu>
