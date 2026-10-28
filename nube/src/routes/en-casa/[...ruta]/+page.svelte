<script lang="ts">
	import { page } from '$app/state';

	/**
	 * A section of the house for good (#253), without jellycartoon's address yet: where to give it.
	 * With it, the bar goes straight there.
	 */
	const where = $derived(`/${page.params.ruta ?? ''}`);
</script>

<svelte:head><title>En casa · Nube</title></svelte:head>

<div class="mx-auto mt-16 max-w-md text-center">
	<h1 class="mb-2 text-2xl font-bold">Está en casa</h1>
	<p class="mb-4 text-zinc-400">
		Esto es de jellycartoon, en casa (<span class="font-mono">{where}</span>). Para ir desde aquí,
		pon su dirección en
		<a href="/ajustes#casa" class="text-amber-400 hover:underline">Ajustes</a>.
	</p>
</div>
