<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import Backdrop from 'comun/components/Backdrop.svelte';
	import { backdropUrl } from '#lib/backdrop.svelte.ts';
	import { formatDuration } from 'comun/format.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const film = $derived(data.film);
	const info = $derived(data.info);
	/** Half watched: «Seguir» first, and «Desde el principio» too. */
	const resume = $derived(!film.completed && (film.positionSec ?? 0) > 5);

	const button =
		'rounded-2xl px-8 py-5 text-3xl font-semibold transition duration-150 focus-visible:scale-105';

	/**
	 * The radio, if it is on, stops. A second OK while the first is on its way is left out; not
	 * disabled, so the button keeps the focus, and the remote with it.
	 */
	let sending = false;
	const once: SubmitFunction = ({ cancel }) => {
		if (sending) return cancel();
		sending = true;
		music.stop();
		return async ({ update }) => {
			await update();
			sending = false;
		};
	};
</script>

<svelte:head>
	<title>{film.title} · JellyCartoon</title>
</svelte:head>

<Backdrop src={backdropUrl('pelicula', film.id)} />

<TvHeader title={film.title} />

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

<div class="grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-12">
	<div>
		<div class="relative aspect-video overflow-hidden rounded-2xl bg-zinc-800 shadow-2xl">
			<img src="/api/movie-thumb/{film.id}" alt="" class="h-full w-full object-cover" />
			{#if resume}
				<div class="absolute inset-x-0 bottom-0 h-2 bg-zinc-700">
					<div
						class="h-full bg-amber-400"
						style:width="{((film.positionSec ?? 0) / (film.durationSec || 1)) * 100}%"
					></div>
				</div>
			{/if}
		</div>

		<!-- The first button gets the focus: OK and it plays. -->
		<div class="mt-8 flex flex-wrap gap-6">
			<form method="post" action="?/play" use:enhance={once}>
				<input type="hidden" name="id" value={film.id} />
				<button class="{button} bg-amber-500 text-zinc-950">
					{resume ? `▶ Seguir desde ${formatDuration(film.positionSec)}` : '▶ Ver'}
				</button>
			</form>
			{#if resume}
				<form method="post" action="?/play" use:enhance={once}>
					<input type="hidden" name="id" value={film.id} />
					<input type="hidden" name="from" value="start" />
					<button class="{button} bg-zinc-800 text-zinc-100">Desde el principio</button>
				</form>
			{/if}
		</div>
	</div>

	<div class="min-w-0">
		<p class="text-2xl text-zinc-400">
			{[film.year, formatDuration(film.durationSec), film.completed && '✓ Vista']
				.filter(Boolean)
				.join(' · ')}
		</p>
		{#if info?.originalTitle && info.originalTitle !== film.title}
			<p class="mt-1 text-xl text-zinc-500 italic">{info.originalTitle}</p>
		{/if}
		{#if info?.synopsis}
			<p class="mt-6 line-clamp-[9] leading-relaxed text-zinc-200">{info.synopsis}</p>
		{/if}
		<dl class="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-xl">
			{#if info?.directors?.length}
				<dt class="text-zinc-500">Dirección</dt>
				<dd>{info.directors.join(', ')}</dd>
			{/if}
			{#if info?.cast?.length}
				<dt class="text-zinc-500">Reparto</dt>
				<dd>{info.cast.slice(0, 6).join(', ')}</dd>
			{/if}
			{#if info?.genres?.length}
				<dt class="text-zinc-500">Género</dt>
				<dd>{info.genres.join(', ')}</dd>
			{/if}
		</dl>
	</div>
</div>
