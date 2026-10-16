<script lang="ts">
	import { enhance } from '$app/forms';
	import TvEpisode from '#lib/components/TvEpisode.svelte';
	import { thumbUrl } from '#lib/thumb.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

{#if data.today}
	<form method="post" action="?/today" use:enhance class="mb-12">
		<button
			class="flex w-full items-center gap-6 rounded-lg border-2 border-amber-500/60 bg-gradient-to-r from-amber-500/20 to-transparent p-5 text-left"
		>
			<img
				src={thumbUrl(data.today.next.id)}
				alt=""
				class="aspect-video w-64 shrink-0 rounded object-cover"
			/>
			<span class="min-w-0">
				<span class="block text-3xl font-semibold text-amber-400">Programación de hoy</span>
				<span class="block truncate">{data.today.next.seriesTitle} · {data.today.next.title}</span>
				<span class="block text-xl text-zinc-400">Quedan {data.today.pending}</span>
			</span>
		</button>
	</form>
{/if}

{#if data.continueWatching.length}
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">Seguir viendo</h2>
		<div class="grid grid-cols-4 gap-8">
			{#each data.continueWatching as ep (ep.id)}
				<TvEpisode
					id={ep.id}
					heading={ep.seriesTitle}
					detail="T{ep.season} E{ep.number} · {ep.title}"
					positionSec={ep.positionSec}
					durationSec={ep.durationSec}
				/>
			{/each}
		</div>
	</section>
{/if}

<section>
	<h2 class="mb-4 text-3xl font-semibold">Series</h2>
	<div class="grid grid-cols-4 gap-8">
		{#each data.series as s (s.id)}
			<a href="/tv/series/{s.id}" class="group block rounded-lg">
				<div class="aspect-video overflow-hidden rounded-lg bg-zinc-800">
					{#if s.cover}
						<img src={thumbUrl(s.cover)} alt="" class="h-full w-full object-cover" />
					{/if}
				</div>
				<p class="mt-2 truncate font-semibold group-focus-visible:text-amber-400">{s.title}</p>
			</a>
		{/each}
	</div>
</section>
