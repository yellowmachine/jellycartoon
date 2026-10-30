<script lang="ts">
	import Landing from '#lib/components/Landing.svelte';
	import Home from '#lib/components/Home.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const tile =
		'flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-6 text-lg font-semibold hover:border-amber-500/60';
</script>

{#if !data.user}
	<Landing {form} />
{:else if 'kid' in data && data.kid}
	<!-- A child's (#303): only what it may open. -->
	<h1 class="mb-6 text-2xl font-bold">Hola, {data.user.name}</h1>
	{#each data.homework as h (h.id)}
		<a
			href="/deberes/hacer/{h.id}"
			class="mb-4 flex items-center gap-4 rounded-lg border border-sky-700/60 bg-gradient-to-r from-sky-500/20 to-transparent p-4 hover:border-sky-400"
		>
			<span class="text-4xl" aria-hidden="true">📚</span>
			<div class="min-w-0">
				<p class="font-semibold text-sky-300">Tienes deberes</p>
				<p class="truncate text-sm">{h.title} · {h.count} preguntas</p>
			</div>
		</a>
	{/each}
	{#if data.inbox.count}
		<a
			href="/buzon"
			class="mb-4 flex items-center gap-4 rounded-lg border border-amber-700/60 bg-gradient-to-r from-amber-500/20 to-transparent p-4 hover:border-amber-400"
		>
			<span class="text-4xl" aria-hidden="true">📬</span>
			<div class="min-w-0">
				<p class="font-semibold text-amber-300">
					{data.inbox.count === 1 ? 'Tienes un aviso' : `Tienes ${data.inbox.count} avisos`}
				</p>
				<p class="truncate text-sm">{data.inbox.latest[0]?.body}</p>
			</div>
		</a>
	{/if}
	<div class="grid grid-cols-2 gap-4">
		<!-- Series and music are the house's: without one connected, not there. -->
		{#if data.house}
			<a href="/series" class={tile}><SectionIcon name="series" class="h-12 w-12" />Series</a>
			<a href="/musica" class={tile}><SectionIcon name="musica" class="h-12 w-12" />Música</a>
		{/if}
		<a href="/agenda" class={tile}><SectionIcon name="agenda" class="h-12 w-12" />Mi agenda</a>
		<a href="/nevera" class={tile}><SectionIcon name="nevera" class="h-12 w-12" />La nevera</a>
	</div>
{:else if data.home}
	<Home
		name={data.user.name}
		home={data.home}
		weather={data.weather}
		trip={data.trip}
		car={data.car}
		watching={data.watching}
		receipts={data.receipts}
	/>
{:else}
	<h1 class="mb-2 text-2xl font-bold">Hola, {data.user.name}</h1>
	<p class="text-sm text-zinc-400">Tu cuenta aún no está en ninguna familia.</p>
{/if}
