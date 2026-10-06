<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Player from '#lib/components/Player.svelte';
	import { playerSize } from '#lib/player-size.svelte.ts';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let items = $derived(data.playlist?.items ?? []);
	let current = $derived(items.findIndex((i) => !i.watched));
	let item = $derived(items[current]);
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

	<!-- In "cinema" the video takes the full width and the list goes below it. -->
	<div class={['grid gap-6', playerSize.value !== 'cinema' && 'lg:grid-cols-[1fr_20rem]']}>
		<div>
			{#if item}
				<Player
					episodeId={item.id}
					startAt={item.watched ? 0 : item.positionSec}
					audioTracks={item.audioTracks}
					subtitles={item.subtitles}
					settings={data.settings}
					onended={invalidateAll}
				/>
				<p class="mt-3 text-sm text-zinc-400">{item.seriesTitle}</p>
				<h2 class="text-lg font-semibold">
					T{item.season} E{item.number} · {item.title}
				</h2>
			{:else}
				<div
					class="flex aspect-video flex-col items-center justify-center gap-4 rounded-md bg-zinc-900"
				>
					<p class="text-lg">¡Programación terminada!</p>
				</div>
			{/if}
		</div>

		<aside>
			<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each items as it, index (it.position)}
					<li>
						<button
							class={[
								'flex w-full items-center gap-3 p-2 text-left hover:bg-zinc-900',
								index === current && 'bg-zinc-900',
								it.watched && index !== current && 'opacity-50'
							]}
							onclick={() => (current = index)}
						>
							<img
								src="/api/thumb/{it.id}"
								alt=""
								class="aspect-video w-20 shrink-0 rounded bg-zinc-800 object-cover"
							/>
							<span class="min-w-0 flex-1">
								<span class="block truncate text-sm">{it.seriesTitle}</span>
								<span class="block truncate text-xs text-zinc-400">
									{it.watched ? '✓ ' : ''}T{it.season} E{it.number} · {it.title}
								</span>
							</span>
							<span class="text-xs text-zinc-500">{formatDuration(it.durationSec)}</span>
						</button>
					</li>
				{/each}
			</ol>
			<div class="mt-4">{@render generator('Otra:')}</div>
		</aside>
	</div>
{/if}
