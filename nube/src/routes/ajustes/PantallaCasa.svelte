<script lang="ts">
	import { onMount } from 'svelte';
	import { section } from '#lib/styles.ts';
	import { vista } from '#lib/vista.svelte.ts';
	import { BACK_MS, DEFAULT_NIGHT, REST_MS } from '#lib/vista-idle.ts';

	/**
	 * «Pantalla de casa» (#525): this device is the tablet on the wall. Opened, it starts in the
	 * Vista; left elsewhere untouched, it goes back to it; and it never turns itself off. And what it
	 * shows while resting: its walks' photos by day, dim at night.
	 */
	onMount(() => vista.load());
	const minutes = (ms: number) => `${ms / 60_000} minutos`;
</script>

<section class={section} id="pantalla-casa">
	<h2 class="mb-1 font-semibold">Pantalla de casa</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Para la tablet colgada en la pared o en su soporte. Al abrir Seilide empieza en la Vista: la
		hora, el tiempo, lo de hoy, la nevera y los enchufes. Si sales a la web de siempre y nadie la
		toca en {minutes(BACK_MS)}, vuelve sola a la Vista; dentro de ella, a los {minutes(REST_MS)}
		sin tocarla descansa y solo enseña la hora y lo que queda del día. La pantalla no se apaga.
	</p>
	<p class="mb-4 text-sm text-zinc-400">
		De noche (en las «Horas de silencio» de la voz o, sin ellas, de {DEFAULT_NIGHT.from} a
		{DEFAULT_NIGHT.to}) descansa al minuto, sin fotos y con todo más oscuro. Seilide no puede bajar
		la luz de la pantalla: activa el brillo automático de la tablet y ella hará el resto.
	</p>
	<label class="flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			checked={vista.homeScreen}
			onchange={(e) => vista.setHomeScreen(e.currentTarget.checked)}
			class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
		/>
		Este aparato es una pantalla de casa
	</label>
	<label class="mt-3 flex items-center gap-2 text-sm">
		<input
			type="checkbox"
			checked={vista.photos}
			onchange={(e) => vista.setPhotos(e.currentTarget.checked)}
			class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
		/>
		De día, fotos de mis paseos de fondo
	</label>
	<p class="mt-1 ml-6 text-xs text-zinc-500">
		Las de los paseos de la cuenta abierta en este aparato, que verá quien pase por delante. Una
		cada minuto, mientras descansa.
	</p>
	<label class={['mt-3 flex items-center gap-2 text-sm', !vista.homeScreen && 'opacity-50']}>
		<input
			type="checkbox"
			checked={vista.lockedChosen}
			disabled={!vista.homeScreen}
			onchange={(e) => vista.setLocked(e.currentTarget.checked)}
			class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
		/>
		Bloqueada, para quien no está acostumbrado
	</label>
	<p class="mt-1 ml-6 text-xs text-zinc-500">
		En la Vista no hay enlaces que lleven fuera de ella (a otras secciones o a otras webs) ni nada
		que administrar (añadir o borrar recetas, listas de música, podcasts), y la voz no la cierra.
		Para salir, mantén pulsado «Salir» 3 segundos. Fija además la aplicación en Android (ver la
		guía).
	</p>
	{#if vista.homeScreen && vista.problem}
		<p class="mt-2 text-sm text-amber-400">{vista.problem}</p>
	{/if}
</section>
