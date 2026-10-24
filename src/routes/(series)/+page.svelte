<script lang="ts">
	import { enhance } from '$app/forms';
	import EpisodePreview from '#lib/components/EpisodePreview.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { thumbUrl } from '#lib/thumb.svelte.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#each data.homework as h (h.id)}
	<a
		href="/deberes/{h.id}"
		class="mb-4 flex items-center gap-4 rounded-lg border border-sky-700/60 bg-gradient-to-r from-sky-500/20 to-transparent p-4 hover:border-sky-400"
	>
		<span class="text-4xl" aria-hidden="true">📚</span>
		<div class="min-w-0">
			<p class="font-semibold text-sky-300">Tienes deberes</p>
			<p class="truncate text-sm">{h.title} · {h.count} preguntas</p>
		</div>
	</a>
{/each}

<a
	href="/today"
	class="mb-10 flex items-center gap-4 rounded-lg border border-zinc-800 bg-gradient-to-r from-amber-500/15 to-transparent p-4 hover:border-amber-500/60"
>
	{#if data.today?.next}
		<img
			src={thumbUrl(data.today.next.id)}
			alt=""
			class="aspect-video w-32 shrink-0 rounded object-cover"
		/>
	{/if}
	<div class="min-w-0">
		<p class="font-semibold text-amber-400">Programación de hoy</p>
		{#if !data.today}
			<p class="text-sm text-zinc-400">Arma una sesión de 30, 60 o 90 minutos con tus series.</p>
		{:else if data.today.next}
			<p class="truncate text-sm">
				A continuación: {data.today.next.seriesTitle} · {data.today.next.title}
			</p>
			<p class="text-xs text-zinc-400">
				Quedan {data.today.pending} de {data.today.total} · {formatDuration(data.today.pendingSec)}
			</p>
		{:else}
			<p class="text-sm text-zinc-400">Terminada. ¿Otra?</p>
		{/if}
	</div>
</a>

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
							<EpisodePreview id={ep.id} durationSec={ep.durationSec} />
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
		<p class="text-zinc-400">
			No hay nada todavía. Ve a <a href="/library" class="text-amber-400 underline">Gestión</a> y escanea
			la carpeta de vídeos.
		</p>
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
						{s.total} episodios{#if s.ready < s.total}
							· {s.ready} listos{/if}
					</p>
				</a>
			{/each}
		</div>
	{/if}
</section>
