<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<h1 class="text-2xl font-bold">{data.series.title}</h1>
	<form method="post" action="?/serialized" use:enhance class="text-sm">
		<input type="hidden" name="serialized" value={String(!data.series.serialized)} />
		<button class="flex items-center gap-2 text-zinc-400 hover:text-white">
			<span
				class={[
					'relative h-5 w-9 rounded-full transition',
					data.series.serialized ? 'bg-amber-500' : 'bg-zinc-700'
				]}
			>
				<span
					class={[
						'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
						data.series.serialized ? 'left-4.5' : 'left-0.5'
					]}
				></span>
			</span>
			{data.series.serialized ? 'Con continuidad: en orden' : 'Episodios sueltos: al azar'}
		</button>
	</form>
</div>

{#each data.seasons as { season, episodes } (season)}
	<h2 class="mt-6 mb-3 font-semibold text-zinc-300">Temporada {season}</h2>
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each episodes as ep (ep.id)}
			{@const ready = ep.status === 'ready'}
			<li>
				<svelte:element
					this={ready ? 'a' : 'div'}
					href={ready ? `/watch/${ep.id}` : undefined}
					class={['flex items-center gap-4 p-3', ready ? 'hover:bg-zinc-900' : 'opacity-60']}
				>
					<div class="relative aspect-video w-32 shrink-0 overflow-hidden rounded bg-zinc-800">
						{#if ready}
							<img
								src="/api/thumb/{ep.id}"
								alt=""
								class="h-full w-full object-cover"
								loading="lazy"
							/>
						{/if}
						{#if ep.positionSec && ep.durationSec}
							<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
								<div
									class="h-full bg-amber-400"
									style:width="{ep.completed ? 100 : (ep.positionSec / ep.durationSec) * 100}%"
								></div>
							</div>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class="truncate">{ep.number}. {ep.title}</p>
						<p class="text-xs text-zinc-400">
							{#if ready}
								{formatDuration(ep.durationSec)}{#if ep.completed}
									· visto{/if}
							{:else if ep.status === 'processing'}
								Convirtiendo… {Math.round(ep.progress * 100)}%
							{:else if ep.status === 'error'}
								<span class="text-red-400">Error al convertir</span>
							{:else}
								En cola
							{/if}
						</p>
					</div>
				</svelte:element>
			</li>
		{/each}
	</ul>
{/each}
