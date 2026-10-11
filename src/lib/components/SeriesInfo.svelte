<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SeriesInfo } from '#lib/server/library/series-info.ts';

	interface Props {
		/** Saved, or still being looked up the first time the page is opened. */
		info: SeriesInfo | { failed: string } | Promise<SeriesInfo | { failed: string }>;
	}

	let { info }: Props = $props();

	let searching = $state(false);
	const searchEnhance = () => {
		searching = true;
		return async ({ update }: { update: () => Promise<void> }) => {
			await update();
			searching = false;
		};
	};

	const secondary = 'rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900';
	const link = 'text-amber-400 hover:underline';
</script>

{#snippet searchForm(label: string)}
	<form
		method="post"
		action="?/searchInfo"
		use:enhance={searchEnhance}
		class="mt-3 flex max-w-xl flex-wrap gap-2"
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

<section class="mb-8">
	{#await info}
		<p class="text-sm text-zinc-400">Buscando la serie en Wikidata y Wikipedia…</p>
	{:then info}
		{#if 'failed' in info}
			<p class="text-sm text-red-400">No se pudo buscar la ficha: {info.failed}</p>
			<form method="post" action="?/refreshInfo" use:enhance class="mt-2">
				<button class={secondary}>Reintentar</button>
			</form>
		{:else if info.status === 'found'}
			<p class="text-sm text-zinc-400">
				{[
					info.originalTitle && info.originalTitle !== info.title
						? `${info.title} (${info.originalTitle})`
						: info.title,
					info.startYear &&
						(info.endYear && info.endYear !== info.startYear
							? `${info.startYear}–${info.endYear}`
							: info.startYear),
					info.seasons && `${info.seasons} temporadas`,
					info.episodes && `${info.episodes} episodios`
				]
					.filter(Boolean)
					.join(' · ')}
			</p>
			{#if info.synopsis}
				<p class="mt-2 max-w-3xl leading-relaxed text-zinc-200">{info.synopsis}</p>
			{/if}
			<p class="mt-2 flex flex-wrap gap-4 text-sm">
				{#if info.wikipediaUrl}
					<a href={info.wikipediaUrl} class={link} target="_blank" rel="noreferrer">Wikipedia</a>
				{/if}
				<a
					href="https://www.wikidata.org/wiki/{info.wikidataId}"
					class={link}
					target="_blank"
					rel="noreferrer">Wikidata</a
				>
				{#each info.episodePages as page (page.lang)}
					<a
						href="https://{page.lang}.wikipedia.org/wiki/{encodeURIComponent(
							page.title.replaceAll(' ', '_')
						)}"
						class={link}
						target="_blank"
						rel="noreferrer">Episodios ({page.lang})</a
					>
				{/each}
			</p>
			<details class="mt-3 text-sm text-zinc-400">
				<summary class="cursor-pointer hover:text-white">¿No es esta serie?</summary>
				{@render searchForm('Buscar otra')}
				<form method="post" action="?/refreshInfo" use:enhance class="mt-2">
					<button class="text-xs hover:text-white hover:underline"
						>Volver a identificarla desde cero</button
					>
				</form>
			</details>
		{:else if info.status === 'ambiguous'}
			<h2 class="mb-3 font-semibold">¿Cuál de estas series es?</h2>
			<ul class="max-w-3xl divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each info.candidates as candidate (candidate.id)}
					<li>
						<form method="post" action="?/chooseInfo" use:enhance>
							<input type="hidden" name="wikidataId" value={candidate.id} />
							<button class="w-full p-3 text-left hover:bg-zinc-900">
								<span class="block">
									{candidate.title}{#if candidate.year}
										<span class="text-zinc-400">{` (${candidate.year})`}</span>{/if}
								</span>
								{#if candidate.description}
									<span class="block text-xs text-zinc-400">{candidate.description}</span>
								{/if}
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
