<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { poll } from '#lib/poll.ts';
	import BirdsEye from '#lib/components/BirdsEye.svelte';
	import Backdrop from '#lib/components/Backdrop.svelte';
	import { backdropUrl, chooseFilmBackdrop } from '#lib/backdrop.svelte.ts';
	import FilmChat from '#lib/components/FilmChat.svelte';
	import Scenes from '#lib/components/Scenes.svelte';
	import TagBar from '#lib/components/TagBar.svelte';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import { awardFamily, filterHref, type FilterName } from '#lib/film-search.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const subtitlesJob = $derived(data.autoSubtitles?.job ?? null);
	// While Whisper makes subtitles, the page follows how it goes.
	$effect(() => {
		if (subtitlesJob?.state !== 'queued' && subtitlesJob?.state !== 'running') return;
		return poll(invalidateAll, 3000);
	});

	const film = $derived(data.film);
	const ready = $derived(film.status === 'ready');
	// mpv starts over below that too.
	const resumeAt = $derived(
		!film.completed && film.positionSec && film.positionSec > 5 ? film.positionSec : 0
	);

	let editing = $state(false);
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

<Backdrop src={backdropUrl('pelicula', film.id)} />
{#if !data.kid && film.backdropSec !== null}
	<button
		class="mb-2 text-xs text-zinc-500 hover:text-zinc-300"
		title="El fondo de arriba lo vuelve a elegir la app"
		onclick={async () => {
			if (await chooseFilmBackdrop(film.id, null)) await invalidateAll();
		}}>Fondo elegido a mano · volver al automático</button
	>
{/if}

{#snippet links(filter: FilterName, names: string[])}
	{#each names as name, i (name)}
		{#if i > 0},{' '}{/if}<a
			href={filterHref(filter, name)}
			class="hover:text-amber-400 hover:underline">{name}</a
		>
	{/each}
{/snippet}

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

<div class="mt-3 min-w-0">
	{#if editing}
		<div class="flex">
			<TitleForm
				action="?/rename"
				value={film.title}
				placeholder={film.autoTitle}
				hidden={{ id: film.id }}
				onclose={() => (editing = false)}
			/>
		</div>
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">
			{film.title}
			{#if !data.kid}
				<button
					class="shrink-0 rounded-md px-2 py-1 text-base text-zinc-500 hover:bg-zinc-800 hover:text-white"
					title="Cambiar título"
					aria-label="Cambiar título"
					onclick={() => (editing = true)}>✎</button
				>
			{/if}
		</h1>
	{/if}
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
		{#if film.completed}
			<span class="ml-1 font-medium text-amber-400">✓ Vista</span>
		{/if}
	</p>
	{#if !data.kid}
		<TagBar tags={data.tags} allTags={data.allTags} class="mt-3" />
	{/if}

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

<section class="mt-8">
	{#await data.info}
		<p class="text-sm text-zinc-400">Buscando la película en Wikidata y Wikipedia…</p>
	{:then info}
		<!-- A child's account sees the info, not how to fix it. -->
		{#if data.kid && !('status' in info && info.status === 'found')}{:else if 'failed' in info}
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
					<dd>{@render links('persona', info.directors)}</dd>
				{/if}
				{#if info.cast.length}
					<dt class="text-zinc-400">Reparto</dt>
					<dd>{@render links('persona', info.cast)}</dd>
				{/if}
				{#if info.genres.length}
					<dt class="text-zinc-400">Género</dt>
					<dd>{@render links('genero', info.genres)}</dd>
				{/if}
				{#if info.countries.length}
					<dt class="text-zinc-400">País</dt>
					<dd>{@render links('pais', info.countries)}</dd>
				{/if}
				{#if info.minutes}
					<dt class="text-zinc-400">Duración</dt>
					<dd>{info.minutes} min</dd>
				{/if}
				{#if info.writers.length}
					<dt class="text-zinc-400">Guion</dt>
					<dd>{@render links('persona', info.writers)}</dd>
				{/if}
				{#if info.composers.length}
					<dt class="text-zinc-400">Música</dt>
					<dd>{@render links('persona', info.composers)}</dd>
				{/if}
				{#if info.cinematographers.length}
					<dt class="text-zinc-400">Fotografía</dt>
					<dd>{@render links('persona', info.cinematographers)}</dd>
				{/if}
				{#if info.blackAndWhite || info.silent}
					<dt class="text-zinc-400">Tipo</dt>
					<dd>
						{#if info.blackAndWhite}<a
								href={filterHref('tipo', 'bn')}
								class="hover:text-amber-400 hover:underline">En blanco y negro</a
							>{/if}{#if info.blackAndWhite && info.silent},{' '}{/if}{#if info.silent}<a
								href={filterHref('tipo', 'muda')}
								class="hover:text-amber-400 hover:underline">Muda</a
							>{/if}
					</dd>
				{/if}
				{#if info.sagas.length}
					<!-- The saga's films, in its order. -->
					<dt class="text-zinc-400">Saga</dt>
					<dd>
						{#each info.sagas as saga, i (saga.name)}
							{#if i},{' '}{/if}<a
								href={filterHref('saga', saga.name)}
								class="hover:text-amber-400 hover:underline">{saga.name}</a
							>{#if saga.order}<span class="ml-1 text-zinc-400">(n.º {saga.order})</span>{/if}
						{/each}
					</dd>
				{/if}
				{#if info.awards.length}
					{@const won = info.awards.filter((a) => a.won)}
					{@const nominated = info.awards.filter((a) => !a.won)}
					<dt class="text-zinc-400">Premios</dt>
					<dd>
						{#if won.length}
							<ul class="space-y-0.5">
								{#each won as award (award.name)}
									<li>
										🏆 <a
											href={filterHref('premio', awardFamily(award.name))}
											class="hover:text-amber-400 hover:underline">{award.name}</a
										>{#if award.year}<span class="ml-1 text-zinc-400">({award.year})</span>{/if}
									</li>
								{/each}
							</ul>
						{/if}
						{#if nominated.length}
							<details class={won.length ? 'mt-1' : ''}>
								<summary class="cursor-pointer text-zinc-400">
									{nominated.length === 1 ? '1 candidatura' : `${nominated.length} candidaturas`}
								</summary>
								<ul class="mt-1 space-y-0.5 text-zinc-400">
									{#each nominated as award (award.name)}
										<li>{award.name}{award.year ? ` (${award.year})` : ''}</li>
									{/each}
								</ul>
							</details>
						{/if}
					</dd>
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

			{#if !data.kid}
				<details class="mt-6 text-sm text-zinc-400">
					<summary class="cursor-pointer hover:text-white">¿No es esta película?</summary>
					{@render searchForm('Buscar otra')}
					<form method="post" action="?/refresh" use:enhance class="mt-2">
						<button class="text-xs hover:text-white hover:underline"
							>Volver a identificarla desde cero</button
						>
					</form>
				</details>
			{/if}
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

{#snippet scenes(info: Awaited<typeof data.info> | null)}
	{@const found = info && 'status' in info && info.status === 'found' ? info : null}
	<Scenes
		movieId={film.id}
		durationSec={film.durationSec!}
		chapters={film.chapters!}
		names={found?.scenes ?? null}
		completed={film.completed ?? false}
		mpv={data.mpv}
		canName={data.canChat && !!found && !data.kid}
		naming={data.naming}
	/>
{/snippet}

{#if ready && film.durationSec && film.chapters?.length}
	{#key film.id}
		{#await data.info}
			{@render scenes(null)}
		{:then info}
			{@render scenes(info)}
		{/await}
	{/key}
{/if}

{#if ready && film.durationSec}
	{#key film.id}
		<BirdsEye movieId={film.id} durationSec={film.durationSec} mpv={data.mpv} />
	{/key}
{/if}

{#if data.kid}
	<!-- No AI conversations for a child's account (#17). -->
{:else if data.canChat}
	<!-- Keyed: another film starts with its own conversation. -->
	{#key film.id}
		<FilmChat movieId={film.id} history={data.chat} />
	{/key}
{:else}
	<p class="mt-8 max-w-3xl border-t border-zinc-800 pt-4 text-sm text-zinc-400">
		Con una clave de OpenRouter en <a href="/ajustes" class="text-amber-400 hover:underline"
			>Ajustes</a
		>
		podrás preguntarle a una IA sobre la película.
	</p>
{/if}

<section class="mt-8 max-w-3xl border-t border-zinc-800 pt-4">
	<h2 class="mb-2 text-sm font-semibold text-zinc-400">El fichero</h2>
	<dl class="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
		<dt class="text-zinc-400">Vídeo</dt>
		<dd>{film.video ?? '—'}</dd>
		<dt class="text-zinc-400">Audio</dt>
		<dd>{film.audioTracks.map((t) => t.label).join(', ') || '—'}</dd>
		<dt class="text-zinc-400">Subtítulos</dt>
		<dd>
			{[...film.subtitles, ...(data.autoSubtitles?.made ?? [])].map((t) => t.label).join(', ') ||
				'Ninguno'}
			<!-- Whisper's, for what has none in the language of its audio: mpv adds them. -->
			{#if data.autoSubtitles && !data.kid}
				{#if subtitlesJob?.state === 'queued'}
					<span class="block text-zinc-400">Subtítulos automáticos: esperando turno…</span>
				{:else if subtitlesJob?.state === 'running'}
					<span class="block text-zinc-400">
						Haciendo subtítulos… {subtitlesJob.total
							? `${Math.round((subtitlesJob.done / subtitlesJob.total) * 100)} %`
							: ''}
					</span>
				{:else if data.autoSubtitles.languages.length}
					{#if subtitlesJob?.state === 'failed'}
						<span class="block text-red-400">No se pudieron hacer: {subtitlesJob.message}</span>
					{/if}
					<!-- One per language: with eight tracks, only the one watched is worth the work. -->
					<form method="post" action="?/autoSubtitles" use:enhance class="mt-1">
						<span class="text-zinc-400">Hacer automáticos en</span>
						{#each data.autoSubtitles.languages as language, i (language.lang)}
							{#if i},{/if}
							<button name="lang" value={language.lang} class="text-amber-400 hover:underline"
								>{language.label}</button
							>
						{/each}
					</form>
				{/if}
			{/if}
		</dd>
		<dt class="text-zinc-400">Fichero</dt>
		<dd class="font-mono text-xs break-all">{film.path} · {formatBytes(film.size)}</dd>
	</dl>
</section>
