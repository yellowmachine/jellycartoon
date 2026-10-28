<script lang="ts">
	import { enhance } from '$app/forms';
	import { thumbUrl } from 'comun/thumb.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * Series (#253), as jellycartoon's: «Seguir viendo» and every series, the house's. Without its
	 * «Hoy» and its lists: at home.
	 */
	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Series · Nube</title>
</svelte:head>

{#if data.problem || data.passProblem}
	<p class="mb-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
		Las series son las de casa: {data.problem ?? data.passProblem}
	</p>
{/if}

{#if data.continueWatching.length}
	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold">Seguir viendo</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.continueWatching as ep (ep.id)}
				<!-- The ✕ is outside the link: removing it does not open the episode. -->
				<div class="group relative">
					<a href="/watch/{ep.id}">
						<div class="relative aspect-video overflow-hidden rounded-md bg-zinc-800">
							<img
								src={thumbUrl(ep.id)}
								alt=""
								class="h-full w-full object-cover group-hover:opacity-80"
							/>
							<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
								<div
									class="h-full bg-amber-400"
									style:width="{(ep.positionSec / (ep.durationSec || 1)) * 100}%"
								></div>
							</div>
						</div>
						<p class="mt-1 truncate text-sm">{ep.seriesTitle}</p>
						<p class="truncate text-xs text-zinc-400">T{ep.season} E{ep.number} · {ep.title}</p>
					</a>
					<form method="post" action="?/dismiss" use:enhance class="absolute top-1 right-1">
						<input type="hidden" name="id" value={ep.id} />
						<!-- Always visible where there is no mouse to hover with. -->
						<button
							class="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-950/70 text-sm text-zinc-200 opacity-70 hover:bg-zinc-950 hover:text-white hover:opacity-100 focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:focus-visible:opacity-100"
							title="Quitar de Seguir viendo"
							aria-label="Quitar de Seguir viendo">✕</button
						>
					</form>
				</div>
			{/each}
		</div>
	</section>
{/if}

<section>
	<h2 class="mb-3 text-lg font-semibold">Series</h2>
	{#if data.series.length === 0}
		<p class="text-zinc-400">No hay nada todavía: se añade en casa, en Gestión.</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.series as s (s.id)}
				<a href="/series/{s.id}" class="group">
					<div class="aspect-video overflow-hidden rounded-md bg-zinc-800">
						{#if s.cover}
							<img
								src={thumbUrl(s.cover)}
								alt=""
								class="h-full w-full object-cover group-hover:opacity-80"
							/>
						{/if}
					</div>
					<p class="mt-1 truncate text-sm font-medium">{s.title}</p>
					<p class="text-xs text-zinc-400">
						{s.total} episodios{#if s.episodes < s.total}
							· {s.episodes} listos{/if}
					</p>
				</a>
			{/each}
		</div>
	{/if}
</section>
