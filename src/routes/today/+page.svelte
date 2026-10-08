<script lang="ts">
	import { enhance } from '$app/forms';
	import PlaylistView from '#lib/components/PlaylistView.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let items = $derived(data.playlist?.items ?? []);
	let totalSec = $derived(items.reduce((sum, i) => sum + (i.durationSec ?? 0), 0));
	let remainingSec = $derived(
		items.filter((i) => !i.watched).reduce((sum, i) => sum + (i.durationSec ?? 0), 0)
	);
</script>

{#snippet generator(label: string)}
	<form method="post" action="?/generate" use:enhance class="flex flex-wrap items-center gap-2">
		<span class="text-sm text-zinc-400">{label}</span>
		{#each data.durations as minutes (minutes)}
			<button
				name="minutes"
				value={minutes}
				class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:border-amber-400 hover:text-amber-400"
			>
				{minutes} min
			</button>
		{/each}
	</form>
{/snippet}

<h1 class="mb-1 text-2xl font-bold">Programación de hoy</h1>

{#if !data.playlist}
	<p class="mb-6 text-zinc-400">
		Una mezcla de episodios de tus series: el siguiente pendiente en las que tienen continuidad, y
		al azar en las demás.
	</p>
	{@render generator('¿Cuánto tiempo?')}
{:else if items.length === 0}
	<p class="mb-6 text-zinc-400">No hay episodios listos para armar la programación.</p>
	{@render generator('Probar otra vez:')}
{:else}
	<p class="mb-6 text-sm text-zinc-400">
		{items.length} episodios · {formatDuration(totalSec)}
		{#if remainingSec && remainingSec < totalSec}· quedan {formatDuration(remainingSec)}{/if}
	</p>

	<PlaylistView {items} settings={data.settings}>
		{#snippet finished()}
			<p class="text-lg">¡Programación terminada!</p>
		{/snippet}
		{#snippet footer()}
			<div class="mt-4">{@render generator('Otra:')}</div>
		{/snippet}
	</PlaylistView>
{/if}
