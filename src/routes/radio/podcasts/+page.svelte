<script lang="ts">
	import { enhance } from '$app/forms';
	import RadioTabs from '#lib/components/RadioTabs.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { playEpisode } from '#lib/podcast-player.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** The feed being followed (it is read first, which takes a moment). */
	let adding = $state<string | null>(null);
	let playError = $state<string | null>(null);

	const followed = $derived(new Set(data.podcasts.map((p) => p.feedUrl)));
	const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

	async function play(id: number) {
		playError = await playEpisode(id);
	}

	const following = (feedUrl: string) => () => {
		adding = feedUrl;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			adding = null;
		};
	};
</script>

<svelte:head>
	<title>Podcasts · JellyCartoon</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-bold">Radio</h1>
<RadioTabs />

<form method="get" class="mb-2 flex max-w-xl gap-2">
	<input
		type="search"
		name="q"
		value={data.q}
		placeholder="Buscar podcasts: historia, inglés, Onda Cero…"
		aria-label="Buscar podcasts"
		class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
	/>
	<button
		class="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-400"
		>Buscar</button
	>
</form>
<details class="mb-6 max-w-xl text-sm" open={Boolean(form?.feedUrl)}>
	<summary class="cursor-pointer text-zinc-400 hover:text-white">
		¿No sale? Pega la dirección de su feed RSS
	</summary>
	<form
		method="post"
		action="?/subscribe"
		class="mt-2 flex gap-2"
		use:enhance={following('manual')}
	>
		<input type="hidden" name="typed" value="1" />
		<input
			type="url"
			name="feedUrl"
			value={form?.feedUrl ?? ''}
			required
			autocomplete="url"
			placeholder="https://…/feed.xml"
			aria-label="Dirección del feed"
			class="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2"
		/>
		<button
			class="rounded-md border border-zinc-600 px-4 py-2 hover:bg-zinc-800"
			disabled={adding !== null}>{adding === 'manual' ? 'Leyendo…' : 'Seguir'}</button
		>
	</form>
</details>

{#if form?.error}
	<p class="mb-4 text-sm text-red-400">{form.error}</p>
{/if}
{#if playError}
	<p class="mb-4 text-sm text-red-400">{playError}</p>
{/if}

{#if data.q}
	<section class="mb-8">
		<h2 class="mb-3 text-lg font-semibold">Resultados para «{data.q}»</h2>
		{#if data.searchError}
			<p class="text-sm text-amber-400">{data.searchError}</p>
		{:else if !data.results?.length}
			<p class="text-sm text-zinc-400">No se ha encontrado ninguno.</p>
		{:else}
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{#each data.results as result (result.feedUrl)}
					<div class="flex items-center gap-3 rounded-md border border-zinc-800 p-3">
						{#if result.imageUrl}
							<img
								src={result.imageUrl}
								alt=""
								loading="lazy"
								class="h-14 w-14 shrink-0 rounded bg-zinc-800 object-cover"
							/>
						{/if}
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{result.title}</span>
							<span class="block truncate text-xs text-zinc-400">{result.author ?? ''}</span>
						</span>
						{#if followed.has(result.feedUrl)}
							<span class="shrink-0 text-xs text-zinc-500">Ya lo sigues</span>
						{:else}
							<form method="post" action="?/subscribe" use:enhance={following(result.feedUrl)}>
								<input type="hidden" name="feedUrl" value={result.feedUrl} />
								<button
									class="shrink-0 rounded-md border border-zinc-600 px-3 py-1.5 text-sm hover:bg-zinc-800"
									disabled={adding !== null}
									>{adding === result.feedUrl ? 'Leyendo…' : 'Seguir'}</button
								>
							</form>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
{/if}

{#if data.inProgress.length}
	<section class="mb-8">
		<h2 class="mb-3 text-lg font-semibold">Seguir escuchando</h2>
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.inProgress as episode (episode.id)}
				{@const on = music.podcast?.id === episode.id}
				<button
					class={[
						'flex items-center gap-3 rounded-md border p-3 text-left hover:bg-zinc-900',
						on ? 'border-amber-500' : 'border-zinc-800'
					]}
					onclick={() => play(episode.id)}
				>
					{#if episode.imageUrl}
						<img
							src={episode.imageUrl}
							alt=""
							class="h-12 w-12 shrink-0 rounded bg-zinc-800 object-cover"
						/>
					{/if}
					<span class="min-w-0 flex-1">
						<span class={['block truncate text-sm font-medium', on && 'text-amber-400']}
							>{episode.title}</span
						>
						<span class="block truncate text-xs text-zinc-400">{episode.podcastTitle}</span>
						<span class="block text-xs text-zinc-500">
							{formatDuration(episode.positionSec)}{episode.durationSec
								? ` de ${formatDuration(episode.durationSec)}`
								: ''}
						</span>
					</span>
					<span class="shrink-0 text-zinc-500">{on && music.playing ? '♪' : '▶︎'}</span>
				</button>
			{/each}
		</div>
	</section>
{/if}

<section class="mb-8">
	<h2 class="mb-3 text-lg font-semibold">Tus podcasts</h2>
	{#if !data.podcasts.length}
		<p class="text-sm text-zinc-400">
			Todavía no sigues ninguno. Busca uno arriba: programas de radio, de historia, para aprender
			idiomas…
		</p>
	{:else}
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
			{#each data.podcasts as p (p.id)}
				<a href="/radio/podcasts/{p.id}" class="group min-w-0">
					{#if p.imageUrl}
						<img
							src={p.imageUrl}
							alt=""
							loading="lazy"
							class="mb-2 aspect-square w-full rounded-md bg-zinc-800 object-cover group-hover:opacity-80"
						/>
					{:else}
						<span
							class="mb-2 flex aspect-square w-full items-center justify-center rounded-md bg-zinc-800 text-4xl"
							>🎙</span
						>
					{/if}
					<span class="block truncate text-sm group-hover:text-amber-400">{p.title}</span>
					<span class="block truncate text-xs text-zinc-500">
						{#if p.lastError}
							<span class="text-amber-400">No se pudo actualizar</span>
						{:else if p.latestAt}
							Último: {day.format(new Date(p.latestAt))}
						{:else}
							{p.author ?? ''}
						{/if}
					</span>
				</a>
			{/each}
		</div>
	{/if}
</section>

<p class="text-xs text-zinc-500">
	Búsqueda en el directorio de podcasts de Apple. Los episodios suenan desde los servidores de cada
	podcast, sin descargarlos.
</p>
