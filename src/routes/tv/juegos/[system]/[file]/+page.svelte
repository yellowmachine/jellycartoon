<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import Backdrop from '#lib/components/Backdrop.svelte';
	import SectionIcon from '#lib/components/SectionIcon.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** What each of a game's pictures is (games.ts' PICTURES). */
	const LABELS: Record<string, string> = {
		titulo: 'Título',
		captura: 'Captura',
		caratula: 'Carátula',
		mia: 'Mi captura'
	};

	const facts = (info: NonNullable<Awaited<typeof data.info>>) =>
		[info.year, info.developers.join(', '), info.genres.join(', '), info.modes.join(', ')].filter(
			Boolean
		);
</script>

<svelte:head>
	<title>{data.title} · JellyCartoon</title>
</svelte:head>

{#await data.backdrop then backdrop}
	{#if backdrop}
		<Backdrop src={backdrop} pixelated />
	{/if}
{/await}

<TvHeader title={data.title} />

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

<div class="mb-12 grid grid-cols-3 gap-12">
	<div>
		<a
			href="{page.url.pathname}/jugar"
			data-focus
			class="flex items-center gap-5 rounded-2xl border-2 border-lime-400/40 bg-zinc-900/90 p-6 transition duration-150 focus-visible:scale-105 focus-visible:border-lime-300 focus-visible:bg-zinc-800"
		>
			<span
				class="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-lime-500/20 text-lime-300"
				><SectionIcon name="juegos" class="h-9 w-9" /></span
			>
			<span>
				<span class="block text-4xl font-semibold">Jugar</span>
				<span class="block text-xl text-zinc-400">{data.system}</span>
			</span>
		</a>
		{#await data.pictures then pictures}
			{#if pictures.length}
				<h2 class="mt-8 mb-3 text-2xl font-semibold text-zinc-300">Fondo</h2>
				<form method="post" action="?/backdrop" use:enhance class="grid grid-cols-4 gap-3">
					{#each pictures as p (p.kind)}
						<button
							name="kind"
							value={p.kind}
							aria-pressed={p.chosen}
							class={[
								'rounded-lg border-2 p-1 text-center transition duration-150 focus-visible:scale-110 focus-visible:border-lime-300',
								p.chosen ? 'border-lime-400' : 'border-transparent'
							]}
						>
							<img
								src={p.url}
								alt=""
								class={[
									'aspect-[4/3] w-full rounded bg-zinc-800 object-contain',
									p.kind !== 'caratula' && 'pixelated'
								]}
							/>
							<span class="mt-1 block truncate text-base text-zinc-400">{LABELS[p.kind]}</span>
						</button>
					{/each}
				</form>
			{/if}
		{/await}
		<!-- Otherwise nobody would know: there is no button for it on the screen. -->
		<p class="mt-4 text-lg text-zinc-500">
			Para usar de fondo un momento del juego, pulsa Play/Pausa en el mando mientras juegas.
		</p>
	</div>

	<div class="col-span-2 min-w-0">
		{#await data.info}
			<p class="text-zinc-400">Buscando el juego en Wikipedia…</p>
		{:then info}
			{#if info?.status === 'found'}
				{@const lines = facts(info)}
				{#if lines.length}
					<p class="text-2xl text-zinc-400">{lines.join(' · ')}</p>
				{/if}
				{#if info.composers.length}
					<p class="mt-1 text-xl text-zinc-500">Música: {info.composers.join(', ')}</p>
				{/if}
				{#if info.synopsis}
					<p class="mt-5 line-clamp-6 leading-relaxed text-zinc-200">{info.synopsis}</p>
				{/if}
			{:else if info?.status === 'ambiguous'}
				<h2 class="mb-4 text-3xl font-semibold">¿Cuál es?</h2>
				<form method="post" action="?/choose" use:enhance class="flex flex-col gap-3">
					{#each info.candidates as c (c.id)}
						<button
							name="wikidataId"
							value={c.id}
							class="rounded-xl border-2 border-white/10 bg-zinc-900/90 px-5 py-3 text-left transition duration-150 focus-visible:scale-[1.02] focus-visible:bg-zinc-800"
						>
							<span class="font-semibold">{c.title}</span>
							{#if c.year}<span class="text-zinc-400"> ({c.year})</span>{/if}
							{#if c.description}
								<span class="block truncate text-xl text-zinc-400">{c.description}</span>
							{/if}
						</button>
					{/each}
				</form>
			{:else if info?.status === 'not_found'}
				<p class="text-zinc-500">No está en Wikidata.</p>
			{/if}
		{/await}
	</div>
</div>

<style>
	.pixelated {
		image-rendering: pixelated;
	}
</style>
