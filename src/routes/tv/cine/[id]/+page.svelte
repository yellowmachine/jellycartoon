<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import Backdrop from 'comun/components/Backdrop.svelte';
	import { backdropUrl } from '#lib/backdrop.svelte.ts';
	import { formatDuration } from 'comun/format.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { sceneFrameAt, sceneNames } from '#lib/scenes.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const film = $derived(data.film);
	const info = $derived(data.info);
	/** Half watched: «Seguir» first, and «Desde el principio» too. */
	const resume = $derived(!film.completed && (film.positionSec ?? 0) > 5);

	const won = $derived(info?.awards.filter((a) => a.won) ?? []);
	const nominations = $derived(info?.awards.filter((a) => !a.won).length ?? 0);
	/** Each language once (a film can have the same one twice), and not the untagged ones. */
	const unique = (labels: string[]) => [...new Set(labels)].join(', ');
	const audio = $derived(
		unique(film.audioTracks.filter((t) => t.lang !== 'und').map((t) => t.label))
	);
	const subtitles = $derived(
		unique([...film.subtitles.map((t) => t.label), ...data.autoSubtitles])
	);

	const chapters = $derived(film.durationSec ? (film.chapters ?? []) : []);
	const named = $derived(sceneNames(chapters, info?.scenes ?? null));
	/** The names tell the plot: seen, they show; if not, only when asked. */
	let revealed = $state(false);
	const showNames = $derived(named.some(Boolean) && (film.completed || revealed));
	const time = (seconds: number) => formatDuration(seconds) || '0:00';

	const button =
		'rounded-2xl px-8 py-5 text-3xl font-semibold transition duration-150 focus-visible:scale-105';
	const small =
		'rounded-xl bg-zinc-800 px-5 py-3 text-xl transition duration-150 focus-visible:scale-105 focus-visible:bg-zinc-700';

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

<div class="max-w-5xl">
	<p class="text-2xl text-zinc-400">
		{[film.year, formatDuration(film.durationSec), film.completed && '✓ Vista']
			.filter(Boolean)
			.join(' · ')}
	</p>
	{#if info?.originalTitle && info.originalTitle !== film.title}
		<p class="mt-1 text-xl text-zinc-500 italic">{info.originalTitle}</p>
	{/if}

	<!-- The first button gets the focus: OK and it plays. -->
	<div class="mt-8 flex flex-wrap gap-6">
		<form method="post" action="?/play" use:enhance={once}>
			<input type="hidden" name="id" value={film.id} />
			<button class="{button} bg-amber-500 text-zinc-950">
				{resume ? `Seguir desde ${formatDuration(film.positionSec)}` : 'Ver'}
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

	{#if page.data.voice && data.canAsk}
		<p class="mt-6 text-xl text-zinc-400">
			🎤 Pulsa el micrófono y pregúntale lo que quieras: de qué va, quién sale, si es para niños…
		</p>
	{/if}

	{#if info?.synopsis}
		<p class="mt-10 line-clamp-[9] leading-relaxed text-zinc-200">{info.synopsis}</p>
		{#if info.synopsisSource === 'ai'}
			<p class="mt-2 text-lg text-zinc-500">
				Sinopsis escrita por la IA: no hay artículo en Wikipedia.
			</p>
		{/if}
	{/if}
	<dl class="mt-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-xl">
		{#if info?.directors?.length}
			<dt class="text-zinc-500">Dirección</dt>
			<dd>{info.directors.join(', ')}</dd>
		{/if}
		{#if info?.cast?.length}
			<dt class="text-zinc-500">Reparto</dt>
			<dd>{info.cast.slice(0, 8).join(', ')}</dd>
		{/if}
		{#if info?.genres?.length}
			<dt class="text-zinc-500">Género</dt>
			<dd>{info.genres.join(', ')}</dd>
		{/if}
		{#if info?.countries.length}
			<dt class="text-zinc-500">País</dt>
			<dd>{info.countries.join(', ')}</dd>
		{/if}
		{#if info?.writers.length}
			<dt class="text-zinc-500">Guion</dt>
			<dd>{info.writers.join(', ')}</dd>
		{/if}
		{#if info?.composers.length}
			<dt class="text-zinc-500">Música</dt>
			<dd>{info.composers.join(', ')}</dd>
		{/if}
		{#if info?.cinematographers.length}
			<dt class="text-zinc-500">Fotografía</dt>
			<dd>{info.cinematographers.join(', ')}</dd>
		{/if}
		{#if info?.blackAndWhite || info?.silent}
			<dt class="text-zinc-500">Tipo</dt>
			<dd>
				{[info.blackAndWhite && 'En blanco y negro', info.silent && 'Muda']
					.filter(Boolean)
					.join(', ')}
			</dd>
		{/if}
		{#if won.length || nominations}
			<dt class="text-zinc-500">Premios</dt>
			<dd>
				{#each won as award (award.name)}
					<p>🏆 {award.name}{award.year ? ` (${award.year})` : ''}</p>
				{/each}
				{#if nominations}
					<p class="text-zinc-400">
						{nominations === 1 ? '1 candidatura' : `${nominations} candidaturas`}{won.length
							? ' más'
							: ''}
					</p>
				{/if}
			</dd>
		{/if}
		{#if audio}
			<dt class="text-zinc-500">Audio</dt>
			<dd>{audio}</dd>
		{/if}
		{#if subtitles}
			<dt class="text-zinc-500">Subtítulos</dt>
			<dd>{subtitles}</dd>
		{/if}
	</dl>

	{#each data.sagas as saga (saga.name)}
		<!-- The saga's other films there are, to go on to them with the remote. -->
		<section class="mt-10">
			<h2 class="text-2xl font-semibold">
				{saga.name}<span class="ml-2 text-zinc-400"
					>· saga{#if saga.order}, esta es la n.º {saga.order}{/if}</span
				>
			</h2>
			{#if saga.films.length}
				<div class="mt-4 flex flex-wrap gap-4">
					{#each saga.films as other (other.id)}
						<a href="/tv/cine/{other.id}" class={small}>
							{#if other.order}<span class="text-zinc-400">{other.order}.</span>{/if}
							{other.title}{#if other.year}<span class="ml-2 text-zinc-400">{other.year}</span>{/if}
						</a>
					{/each}
				</div>
			{:else}
				<p class="mt-2 text-xl text-zinc-500">No hay otras películas de la saga.</p>
			{/if}
		</section>
	{/each}
</div>

{#if chapters.length}
	<section class="mt-12">
		<div class="flex flex-wrap items-center gap-6">
			<h2 class="text-2xl font-semibold">Escenas</h2>
			<span class="text-xl text-zinc-500">OK para verla desde ahí</span>
			{#if named.some(Boolean) && !showNames}
				<button class={small} onclick={() => (revealed = true)}>
					Mostrar los nombres (cuentan la película)
				</button>
			{/if}
		</div>
		<ul class="mt-6 grid grid-cols-5 gap-6">
			{#each chapters as chapter, i (chapter.startSec)}
				{@const at = Math.floor(chapter.startSec)}
				<li class="min-w-0">
					<form method="post" action="?/play" use:enhance={once}>
						<input type="hidden" name="id" value={film.id} />
						<input type="hidden" name="at" value={at} />
						<button
							class="group block w-full rounded-lg text-left transition-transform duration-150 focus-visible:scale-105"
							aria-label="Escena {i + 1}, en {time(at)}"
						>
							<div class="aspect-video overflow-hidden rounded-lg bg-zinc-800">
								<img
									src="/api/movie-frame/{film.id}/{sceneFrameAt(
										chapters,
										i,
										film.durationSec!
									)}?w=480"
									alt=""
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							</div>
							<p class="mt-2 text-lg text-zinc-400 tabular-nums group-focus-visible:text-amber-400">
								{i + 1} · {time(at)}
							</p>
							{#if showNames && named[i]}
								<p class="line-clamp-2 text-lg leading-snug">{named[i]}</p>
							{/if}
						</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>
{/if}
