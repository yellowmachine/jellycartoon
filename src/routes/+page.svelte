<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.continueWatching.length}
	<section class="mb-10">
		<h2 class="mb-3 text-lg font-semibold">Seguir viendo</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.continueWatching as ep (ep.id)}
				<a href="/watch/{ep.id}" class="group">
					<div class="relative aspect-video overflow-hidden rounded-md bg-zinc-800">
						<img
							src="/api/thumb/{ep.id}"
							alt=""
							class="h-full w-full object-cover group-hover:opacity-80"
						/>
						<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
							<div
								class="h-full bg-amber-400"
								style:width="{(ep.position_sec / (ep.duration_sec || 1)) * 100}%"
							></div>
						</div>
					</div>
					<p class="mt-1 truncate text-sm">{ep.series_title}</p>
					<p class="truncate text-xs text-zinc-400">T{ep.season} E{ep.number} · {ep.title}</p>
				</a>
			{/each}
		</div>
	</section>
{/if}

<section>
	<h2 class="mb-3 text-lg font-semibold">Series</h2>
	{#if data.series.length === 0}
		<p class="text-zinc-400">
			No hay nada todavía. Ve a <a href="/library" class="text-amber-400 underline">Biblioteca</a> y escanea
			la carpeta de vídeos.
		</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.series as s (s.id)}
				<a href="/series/{s.id}" class="group">
					<div class="aspect-video overflow-hidden rounded-md bg-zinc-800">
						{#if s.cover}
							<img
								src="/api/thumb/{s.cover}"
								alt=""
								class="h-full w-full object-cover group-hover:opacity-80"
							/>
						{/if}
					</div>
					<p class="mt-1 truncate text-sm font-medium">{s.title}</p>
					<p class="text-xs text-zinc-400">
						{s.total} episodios{#if s.ready < s.total}
							· {s.ready} listos{/if}
					</p>
				</a>
			{/each}
		</div>
	{/if}
</section>
