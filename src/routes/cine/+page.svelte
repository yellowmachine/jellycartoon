<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import MovieMenu from '#lib/components/MovieMenu.svelte';
	import SalonBar from '#lib/components/SalonBar.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let scanning = $state(false);
	let editing = $state<number | null>(null);
	let search = $state('');

	/** Without accents or case: `dalmatas` finds `101 dálmatas`. */
	const normalize = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

	const shown = $derived(
		search.trim()
			? data.movies.filter((m) => normalize(m.title).includes(normalize(search.trim())))
			: data.movies
	);

	// Refresh while films are being catalogued; not while a title is being edited.
	$effect(() => {
		if (data.pending === 0) return;
		const timer = setInterval(() => editing === null && invalidateAll(), 3000);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>Cine · JellyCartoon</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="mr-auto text-2xl font-bold">Cine</h1>
	<input
		type="search"
		bind:value={search}
		placeholder="Buscar película"
		aria-label="Buscar película"
		class="w-56 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
	/>
	<form
		method="post"
		action="?/scan"
		use:enhance={() => {
			scanning = true;
			return async ({ update }) => {
				await update();
				scanning = false;
			};
		}}
	>
		<button
			disabled={scanning}
			class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		>
			{scanning ? 'Escaneando…' : 'Escanear carpeta'}
		</button>
	</form>
</div>

{#if form && 'playing' in form && form.playing}
	<p class="-mt-4 mb-4 text-sm text-amber-400">▶︎ En el salón: {form.playing}</p>
{/if}
{#if form && 'message' in form && form.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}
{#if form && 'scan' in form && form.scan}
	<p class="-mt-4 mb-4 text-sm text-zinc-400">
		{form.scan.added} nuevas · {form.scan.changed} cambiadas · {form.scan.missing} desaparecidas
		{#if form.scan.waiting}
			<br />{form.scan.waiting} aún se están copiando: vuelve a escanear en un minuto.
		{/if}
		{#if form.scan.discs.length}
			<br />Sin catalogar, porque son copias de disco (BDMV o VIDEO_TS): {form.scan.discs.join(
				', '
			)}.
		{/if}
	</p>
{/if}
{#if data.pending}
	<p class="mb-4 text-sm text-amber-400">
		Catalogando: quedan {data.pending}. Se saca la duración, las pistas y una miniatura de cada una.
	</p>
{/if}

{#if data.movies.length === 0}
	<p class="text-zinc-400">No hay películas todavía. Pulsa «Escanear carpeta».</p>
{:else if shown.length === 0}
	<p class="text-zinc-400">Ninguna película coincide con «{search}».</p>
{:else}
	<ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
		{#each shown as movie (movie.id)}
			<li class="min-w-0">
				<a
					href="/cine/{movie.id}"
					class="relative block aspect-video overflow-hidden rounded-md bg-zinc-800 hover:opacity-80"
				>
					{#if movie.status === 'ready'}
						<img
							src="/api/movie-thumb/{movie.id}"
							alt=""
							class="h-full w-full object-cover"
							loading="lazy"
						/>
						{#if movie.completed}
							<span
								class="absolute top-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
								>✓ Vista</span
							>
						{:else if movie.positionSec && movie.durationSec}
							<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
								<div
									class="h-full bg-amber-400"
									style:width="{(movie.positionSec / movie.durationSec) * 100}%"
								></div>
							</div>
						{/if}
					{:else}
						<p
							class={[
								'flex h-full items-center justify-center p-2 text-center text-xs',
								movie.status === 'error' ? 'text-red-400' : 'text-zinc-400'
							]}
						>
							{movie.status === 'error' ? 'No se pudo catalogar' : 'Catalogando…'}
						</p>
					{/if}
				</a>
				{#if editing === movie.id}
					<div class="mt-1 flex">
						<TitleForm
							action="?/rename"
							value={movie.title}
							placeholder={movie.autoTitle}
							hidden={{ id: movie.id }}
							onclose={() => (editing = null)}
						/>
					</div>
				{:else}
					<div class="mt-1 flex items-start gap-1">
						<div class="min-w-0 flex-1">
							<a
								href="/cine/{movie.id}"
								class="block truncate text-sm hover:text-amber-400"
								title={movie.title}>{movie.title}</a
							>
							<p class="text-xs text-zinc-400">
								{[movie.year, formatDuration(movie.durationSec)].filter(Boolean).join(' · ') || ' '}
							</p>
						</div>
						<MovieMenu {movie} mpv={data.mpv} onrename={() => (editing = movie.id)} />
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.mpv}
	<SalonBar />
{/if}
