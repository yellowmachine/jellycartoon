<script lang="ts">
	import { section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<h1 class="mb-6 text-2xl font-bold">Hola, {data.user?.name}</h1>

<section class={section}>
	<h2 class="mb-1 font-semibold">Tu casa</h2>
	{#if data.house}
		<p class="text-sm text-zinc-400">
			Conectada con <span class="font-mono">{data.house.url}</span>: la música y las series de casa,
			desde aquí.
		</p>
	{:else}
		<p class="text-sm text-zinc-400">
			Sin conectar. {#if data.family?.admin}Conéctala en <a
					href="/ajustes"
					class="text-amber-400 hover:underline">Ajustes</a
				>.{:else}Lo hace quien administra tu familia.{/if}
		</p>
	{/if}
</section>

<div class="mb-8 grid gap-4 sm:grid-cols-2">
	<a href="/nevera" class="rounded-md border border-zinc-800 p-4 hover:border-amber-500/60">
		<span class="text-2xl" aria-hidden="true">📌</span>
		<h2 class="font-semibold">Nevera</h2>
		<p class="text-sm text-zinc-400">Post-its y la lista de la compra.</p>
	</a>
	<a href="/recetas" class="rounded-md border border-zinc-800 p-4 hover:border-amber-500/60">
		<span class="text-2xl" aria-hidden="true">🍳</span>
		<h2 class="font-semibold">Recetas</h2>
		<p class="text-sm text-zinc-400">El recetario de la familia.</p>
	</a>
</div>

<section class={section}>
	<h2 class="mb-1 font-semibold">Modo carretera</h2>
	<p class="text-sm text-zinc-400">Pronto: la ruta, la música de casa y la radio, en el coche.</p>
</section>
