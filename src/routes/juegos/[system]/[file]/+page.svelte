<script lang="ts">
	import { page } from '$app/state';
	import Backdrop from 'comun/components/Backdrop.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { formatPlayed } from 'comun/format.ts';
	import type { PageProps } from './$types';

	/** A game's page in the browser (#405): «Jugar», going on from a saved game, and what it is. */
	let { data }: PageProps = $props();

	const when = (iso: string) =>
		new Date(iso).toLocaleString('es', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<svelte:head>
	<title>{data.title} · JellyCartoon</title>
</svelte:head>

{#await data.backdrop then backdrop}
	{#if backdrop}
		<Backdrop src={backdrop} pixelated />
	{/if}
{/await}

<a
	href="/juegos/{encodeURIComponent(page.params.system!)}"
	class="text-sm text-zinc-400 hover:text-white">← {data.system}</a
>
<h1 class="mt-2 mb-4 text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">{data.title}</h1>

<a
	href="{page.url.pathname}/jugar"
	class="inline-flex items-center gap-2 rounded-lg bg-lime-400 px-6 py-3 font-semibold text-zinc-950 hover:bg-lime-300"
	><SectionIcon name="juegos" class="h-6 w-6" />Jugar</a
>
{#if data.played.seconds >= 60 && data.played.last}
	<p class="mt-3 text-sm text-zinc-300">
		Has jugado {formatPlayed(data.played.seconds)} · la última vez, {when(data.played.last)}
	</p>
{/if}

{#if data.saves.length}
	<section class="mt-8">
		<h2 class="mb-3 font-semibold">Partidas guardadas</h2>
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
			{#each data.saves as save (save.id)}
				<a href="{page.url.pathname}/jugar?partida={save.id}" class="group block">
					<div class="aspect-[4/3] overflow-hidden rounded-lg bg-zinc-800">
						{#if save.picture}
							<img
								src={save.picture}
								alt=""
								loading="lazy"
								class="h-full w-full object-cover [image-rendering:pixelated]"
							/>
						{:else}
							<span class="flex h-full items-center justify-center text-zinc-600"
								><SectionIcon name="juegos" class="h-1/3 w-1/3" /></span
							>
						{/if}
					</div>
					<p class="mt-1 text-sm group-hover:text-lime-300 first-letter:uppercase">
						{when(save.createdAt)}
					</p>
				</a>
			{/each}
		</div>
	</section>
{/if}

{#await data.info then info}
	{#if info?.status === 'found'}
		{@const facts = [
			info.year,
			info.developers.join(', '),
			info.genres.join(', '),
			info.modes.join(', ')
		].filter(Boolean)}
		<section class="mt-8 max-w-3xl">
			{#if facts.length}<p class="text-sm text-zinc-400">{facts.join(' · ')}</p>{/if}
			{#if info.composers.length}
				<p class="text-sm text-zinc-500">Música: {info.composers.join(', ')}</p>
			{/if}
			{#if info.synopsis}<p class="mt-3 leading-relaxed text-zinc-200">{info.synopsis}</p>{/if}
		</section>
	{/if}
{/await}
