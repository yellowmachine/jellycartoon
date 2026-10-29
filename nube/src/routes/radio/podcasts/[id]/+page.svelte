<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { formatDuration } from 'comun/format.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { playEpisode } from 'comun/podcast-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const podcast = $derived(data.podcast);
	let playError = $state<string | null>(null);
	let refreshing = $state(false);
	/** Long feeds: the newest first, and the rest on asking. */
	const PAGE = 50;
	let shown = $state(PAGE);

	const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

	async function play(id: number) {
		playError = await playEpisode(id);
	}

	// What was listened to while on this page (here or elsewhere), when it closes or changes.
	let lastEpisode = $state<number | null>(null);
	$effect(() => {
		const id = music.podcast?.id ?? null;
		if (lastEpisode !== null && id !== lastEpisode) void invalidateAll();
		lastEpisode = id;
	});

	const section = 'mb-1 text-xs tracking-wide text-zinc-500 uppercase';
	const small = 'rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800';
</script>

<svelte:head>
	<title>{podcast.title} · Podcasts · Seilide</title>
</svelte:head>

<a href="/radio/podcasts" class="text-sm text-zinc-400 hover:text-white">← Podcasts</a>

<header class="mt-2 mb-6 flex flex-col gap-4 sm:flex-row">
	{#if podcast.imageUrl}
		<img
			src={podcast.imageUrl}
			alt=""
			class="h-40 w-40 shrink-0 rounded-md bg-zinc-800 object-cover"
		/>
	{/if}
	<div class="min-w-0">
		<h1 class="text-2xl font-bold">{podcast.title}</h1>
		{#if podcast.author}<p class="text-zinc-400">{podcast.author}</p>{/if}
		{#if podcast.description}
			<p class="mt-2 max-w-3xl text-sm whitespace-pre-line text-zinc-300">{podcast.description}</p>
		{/if}
		<div class="mt-3 flex flex-wrap items-center gap-2">
			{#if podcast.subscribed}
				<form
					method="post"
					action="?/refresh"
					use:enhance={() => {
						refreshing = true;
						return async ({ update }) => {
							await update();
							refreshing = false;
						};
					}}
				>
					<button class={small} disabled={refreshing}
						>{refreshing ? 'Buscando…' : 'Buscar episodios nuevos'}</button
					>
				</form>
				<form method="post" action="?/unsubscribe" use:enhance>
					<button class="{small} text-zinc-400">Dejar de seguir</button>
				</form>
			{:else}
				<form method="post" action="?/subscribe" use:enhance>
					<button
						class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
						>Seguir</button
					>
				</form>
			{/if}
			{#if podcast.link}
				<a
					href={podcast.link}
					target="_blank"
					rel="noreferrer"
					class="text-sm text-zinc-400 hover:underline">Su web</a
				>
			{/if}
		</div>
		{#if form?.error || podcast.lastError}
			<p class="mt-2 text-sm text-amber-400">
				No se pudo actualizar: {form?.error ?? podcast.lastError}
			</p>
		{/if}
		{#if playError}<p class="mt-2 text-sm text-red-400">{playError}</p>{/if}
	</div>
</header>

<h2 class={section}>{podcast.episodes.length} episodios</h2>
<ul class="divide-y divide-zinc-800">
	{#each podcast.episodes.slice(0, shown) as episode (episode.id)}
		{@const on = music.podcast?.id === episode.id}
		{@const started = !episode.completed && (episode.positionSec ?? 0) > 5}
		<li class="flex items-start gap-3 py-3">
			<button
				class={[
					'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
					on ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700'
				]}
				aria-label={on && music.playing ? 'Pausa' : `Escuchar «${episode.title}»`}
				onclick={() => (on ? music.toggle() : play(episode.id))}
				>{on && music.playing ? '❚❚' : '▶︎'}</button
			>
			<div class="min-w-0 flex-1">
				<p
					class={[
						'font-medium',
						on && 'text-amber-400',
						episode.completed && !on && 'text-zinc-500'
					]}
				>
					{episode.title}
				</p>
				<p class="text-xs text-zinc-500">
					{#if episode.publishedAt}{day.format(new Date(episode.publishedAt))}{/if}
					{#if episode.durationSec}
						· {formatDuration(episode.durationSec)}{/if}
					{#if episode.completed}
						· Escuchado
					{:else if started}
						· <span class="text-amber-400">Vas por {formatDuration(episode.positionSec)}</span>
					{/if}
				</p>
				{#if started && episode.durationSec}
					<div class="mt-1 h-1 max-w-xs overflow-hidden rounded bg-zinc-800">
						<div
							class="h-full bg-amber-500"
							style:width="{Math.min(100, (episode.positionSec! / episode.durationSec) * 100)}%"
						></div>
					</div>
				{/if}
				{#if episode.description}
					<details class="mt-1 text-sm text-zinc-400">
						<summary class="cursor-pointer text-xs text-zinc-500 hover:text-white"
							>De qué va</summary
						>
						<p class="mt-1 whitespace-pre-line">{episode.description}</p>
					</details>
				{/if}
			</div>
			<form method="post" action="?/listened" use:enhance class="shrink-0">
				<input type="hidden" name="episodeId" value={episode.id} />
				<input type="hidden" name="value" value={String(!episode.completed)} />
				<button
					class="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-white"
					title={episode.completed ? 'Marcar como no escuchado' : 'Marcar como escuchado'}
					>{episode.completed ? '✓' : '○'}</button
				>
			</form>
		</li>
	{/each}
</ul>
{#if podcast.episodes.length > shown}
	<button class="{small} mt-4" onclick={() => (shown += PAGE)}>
		Ver más ({podcast.episodes.length - shown} más antiguos)
	</button>
{/if}
