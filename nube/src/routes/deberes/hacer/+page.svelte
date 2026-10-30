<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Deberes · Seilide</title>
</svelte:head>

<h1 class="mb-6 text-2xl font-bold">Tus deberes</h1>
{#each data.homework as h (h.id)}
	<a
		href="/deberes/hacer/{h.id}"
		class="mb-4 flex items-center gap-4 rounded-lg border border-sky-700/60 bg-gradient-to-r from-sky-500/20 to-transparent p-4 hover:border-sky-400"
	>
		<span class="text-4xl" aria-hidden="true">📚</span>
		<div class="min-w-0">
			<p class="font-semibold text-sky-300">{h.title}</p>
			<p class="text-sm">{h.count} preguntas</p>
		</div>
	</a>
{:else}
	<p class="text-zinc-400">No tienes deberes. ¡A jugar!</p>
{/each}
