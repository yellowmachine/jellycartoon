<script lang="ts">
	import { page } from '$app/state';
	import Dibujo from 'comun/components/Dibujo.svelte';

	/** A mistake in the address or a page that is not there (4xx), or the server failing (5xx). */
	const broken = $derived(page.status >= 500);
	// SvelteKit's own, in English («Not Found», «Internal Error»), say nothing the drawing does not.
	const detail = $derived(
		!broken && page.error?.message !== 'Not Found' ? page.error?.message : undefined
	);
	const primary =
		'rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400';
</script>

<svelte:head>
	<title>{broken ? 'Error' : page.status === 404 ? 'No encontrado' : page.status} · Seilide</title>
</svelte:head>

<section class="mx-auto flex max-w-md flex-col items-center gap-5 py-12 text-center">
	{#if broken}
		<!-- The snail gone into its shell. -->
		<Dibujo name="500" class="w-72 text-zinc-100" />
		<h1 class="text-2xl font-bold text-amber-400">Algo ha fallado</h1>
		<p class="text-zinc-400">
			Nos hemos metido en la concha un momento. Prueba otra vez en un rato.
		</p>
		<div class="flex gap-3">
			<button onclick={() => location.reload()} class={primary}>Reintentar</button>
			<a href="/" class="rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-900"
				>Volver al inicio</a
			>
		</div>
	{:else}
		<!-- The trail goes round in a loop and the snail does not know where it is. -->
		<Dibujo name="404" class="w-72 text-zinc-100" />
		<h1 class="text-2xl font-bold text-amber-400">Por aquí no se va a ninguna parte</h1>
		<p class="text-zinc-400">
			{page.status === 404
				? 'Esta página no existe, o se ha ido a otro sitio.'
				: 'Esto no se puede hacer.'}
		</p>
		{#if detail}
			<p class="text-sm text-zinc-500">{detail}</p>
		{/if}
		<a href="/" class={primary}>Volver al inicio</a>
	{/if}
</section>
