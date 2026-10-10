<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const film = $derived(data.film);
	const ready = $derived(film.status === 'ready');
	// mpv starts over below that too.
	const resumeAt = $derived(
		!film.completed && film.positionSec && film.positionSec > 5 ? film.positionSec : 0
	);

	let searching = $state(false);
	const searchEnhance = () => {
		searching = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			searching = false;
		};
	};

	const primary =
		'rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400';
	const secondary = 'rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900';
</script>

<svelte:head>
	<title>{film.title} · JellyCartoon</title>
</svelte:head>

{#snippet searchForm(label: string)}
	<form
		method="post"
		action="?/search"
		use:enhance={searchEnhance}
		class="mt-3 flex flex-wrap gap-2"
	>
		<input
			name="title"
			placeholder="Título, mejor el original"
			aria-label={label}
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
		/>
		<button class={secondary} disabled={searching}>{searching ? 'Buscando…' : label}</button>
	</form>
{/snippet}

<a href="/cine" class="text-sm text-zinc-400 hover:text-white">← Cine</a>

<div class="mt-3 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
	<div class="relative aspect-video overflow-hidden rounded-md bg-zinc-800">
		{#if ready}
			<img src="/api/movie-thumb/{film.id}" alt="" class="h-full w-full object-cover" />
		{/if}
		{#if film.completed}
			<span
				class="absolute top-2 left-2 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
				>✓ Vista</span
			>
		{:else if film.positionSec && film.durationSec}
			<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
				<div
					class="h-full bg-amber-400"
					style:width="{(film.positionSec / film.durationSec) * 100}%"
				></div>
			</div>
		{/if}
	</div>

	<div class="min-w-0">
		<h1 class="text-2xl font-bold">{film.title}</h1>
		{#await data.info then info}
			{#if 'status' in info && info.status === 'found'}
				<p class="mt-1 text-sm text-zinc-400">
					{[
						info.originalTitle && info.originalTitle !== film.title ? info.originalTitle : null,
						info.year,
						info.directors.join(', ')
					]
						.filter(Boolean)
						.join(' · ')}
				</p>
			{/if}
		{/await}
		<p class="mt-1 text-sm text-zinc-400">
			{[film.year, formatDuration(film.durationSec)].filter(Boolean).join(' · ')}
		</p>

		{#if ready && data.mpv}
			<div class="mt-4 flex flex-wrap gap-2">
				{#if resumeAt}
					<form method="post" action="?/play" use:enhance>
						<input type="hidden" name="id" value={film.id} />
						<button class={primary}>▶︎ Continuar desde {formatDuration(resumeAt)}</button>
					</form>
				{/if}
				<form method="post" action="?/play" use:enhance>
					<input type="hidden" name="id" value={film.id} />
					<input type="hidden" name="from" value="start" />
					<button class={resumeAt ? secondary : primary}>
						{resumeAt ? 'Desde el principio' : '▶︎ Ver en el salón'}
					</button>
				</form>
				<form method="post" action="?/setWatched" use:enhance>
					<input type="hidden" name="id" value={film.id} />
					<input type="hidden" name="watched" value={String(!film.completed)} />
					<button class={secondary}>
						{film.completed ? 'Marcar como no vista' : 'Marcar como vista'}
					</button>
				</form>
			</div>
		{/if}
		{#if form && 'playing' in form && form.playing}
			<p class="mt-3 text-sm text-amber-400">
				▶︎ En el salón. <a href="/salon" class="underline">Abrir el mando</a>
			</p>
		{/if}
		{#if form && 'message' in form && form.message}
			<p class="mt-3 text-sm text-red-400">{form.message}</p>
		{/if}
	</div>
</div>

<section class="mt-8">
	{#await data.info}
		<p class="text-sm text-zinc-400">Buscando la película en Wikidata y Wikipedia…</p>
	{:then info}
		{#if 'failed' in info}
			<p class="text-sm text-red-400">No se pudo buscar la ficha: {info.failed}</p>
			<form method="post" action="?/refresh" use:enhance class="mt-2">
				<button class={secondary}>Reintentar</button>
			</form>
		{:else if info.status === 'found'}
			{#if info.synopsis}
				<p class="max-w-3xl leading-relaxed text-zinc-200">{info.synopsis}</p>
				<p class="mt-1 text-xs text-zinc-500">
					{#if info.synopsisSource === 'ai'}
						Sinopsis generada por IA: no hay artículo en Wikipedia.
					{:else if info.wikipediaUrl}
						De <a href={info.wikipediaUrl} class="hover:underline" target="_blank" rel="noreferrer"
							>Wikipedia</a
						>.
					{/if}
				</p>
			{/if}

			<dl class="mt-6 grid max-w-3xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
				{#if info.directors.length}
					<dt class="text-zinc-400">Dirección</dt>
					<dd>{info.directors.join(', ')}</dd>
				{/if}
				{#if info.cast.length}
					<dt class="text-zinc-400">Reparto</dt>
					<dd>{info.cast.join(', ')}</dd>
				{/if}
				{#if info.genres.length}
					<dt class="text-zinc-400">Género</dt>
					<dd>{info.genres.join(', ')}</dd>
				{/if}
				{#if info.countries.length}
					<dt class="text-zinc-400">País</dt>
					<dd>{info.countries.join(', ')}</dd>
				{/if}
				{#if info.minutes}
					<dt class="text-zinc-400">Duración</dt>
					<dd>{info.minutes} min</dd>
				{/if}
			</dl>

			<p class="mt-4 flex flex-wrap gap-4 text-sm">
				{#if info.wikipediaUrl}
					<a
						href={info.wikipediaUrl}
						class="text-amber-400 hover:underline"
						target="_blank"
						rel="noreferrer">Wikipedia</a
					>
				{/if}
				<a
					href="https://www.wikidata.org/wiki/{info.wikidataId}"
					class="text-amber-400 hover:underline"
					target="_blank"
					rel="noreferrer">Wikidata</a
				>
				{#if info.imdbId}
					<a
						href="https://www.imdb.com/title/{info.imdbId}/"
						class="text-amber-400 hover:underline"
						target="_blank"
						rel="noreferrer">IMDb</a
					>
				{/if}
			</p>

			<details class="mt-6 text-sm text-zinc-400">
				<summary class="cursor-pointer hover:text-white">¿No es esta película?</summary>
				{@render searchForm('Buscar otra')}
				<form method="post" action="?/refresh" use:enhance class="mt-2">
					<button class="text-xs hover:text-white hover:underline"
						>Volver a identificarla desde cero</button
					>
				</form>
			</details>
		{:else if info.status === 'ambiguous'}
			<h2 class="mb-3 font-semibold">¿Cuál de estas es?</h2>
			<ul class="max-w-3xl divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each info.candidates as candidate (candidate.id)}
					<li>
						<form method="post" action="?/choose" use:enhance>
							<input type="hidden" name="wikidataId" value={candidate.id} />
							<button class="w-full p-3 text-left hover:bg-zinc-900">
								<span class="block">
									{candidate.title}{#if candidate.year}
										<span class="text-zinc-400">{` (${candidate.year})`}</span>{/if}
								</span>
								<span class="block text-xs text-zinc-400">
									{[candidate.directors.join(', '), candidate.description]
										.filter(Boolean)
										.join(' · ')}
								</span>
							</button>
						</form>
					</li>
				{/each}
			</ul>
			<p class="mt-4 text-sm text-zinc-400">¿Ninguna? Búscala por su título:</p>
			{@render searchForm('Buscar')}
		{:else}
			<p class="text-sm text-zinc-400">
				No la he encontrado en Wikidata. Prueba con su título original:
			</p>
			{@render searchForm('Buscar')}
		{/if}
	{/await}
</section>

<section class="mt-8 max-w-3xl border-t border-zinc-800 pt-4">
	<h2 class="mb-2 text-sm font-semibold text-zinc-400">El fichero</h2>
	<dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
		<dt class="text-zinc-400">Vídeo</dt>
		<dd>{film.video ?? '—'}</dd>
		<dt class="text-zinc-400">Audio</dt>
		<dd>{film.audioTracks.map((t) => t.label).join(', ') || '—'}</dd>
		<dt class="text-zinc-400">Subtítulos</dt>
		<dd>{film.subtitles.map((t) => t.label).join(', ') || 'Ninguno'}</dd>
		<dt class="text-zinc-400">Fichero</dt>
		<dd class="font-mono text-xs break-all">{film.path} · {formatBytes(film.size)}</dd>
	</dl>
</section>
