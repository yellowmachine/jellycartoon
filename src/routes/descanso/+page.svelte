<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Descanso · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-xl py-16 text-center">
	<p class="mb-6 text-7xl" aria-hidden="true">🌙</p>
	<h1 class="mb-4 text-3xl font-bold">Hora de descansar</h1>
	<p class="text-xl text-zinc-300">{data.closed}</p>
	<p class="mt-8 text-zinc-400">
		Mientras tanto, puedes escuchar la <a href="/radio" class="text-amber-400 hover:underline"
			>radio</a
		>.
	</p>
</div>
