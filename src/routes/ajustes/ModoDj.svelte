<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Modo DJ: el locutor entre canciones o mezclado (#117). */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.music}
	<section class={section} id="modo-dj">
		<h2 class="mb-1 font-semibold">Modo DJ</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Cuándo habla el locutor. Mezclada, como en la radio: entra al final de una canción con la
			música más baja, y la siguiente empieza por debajo de su voz. De momento solo en el navegador;
			en los altavoces de casa sigue hablando entre canciones.
		</p>
		<form
			method="post"
			action="?seccion={tab}&/djMix"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
			class="flex flex-wrap gap-2"
		>
			{#each [['between', 'Entre canciones'], ['mix', 'Mezclada con las canciones']] as const as [value, label] (value)}
				<button
					name="djMix"
					{value}
					aria-pressed={data.djMix === (value === 'mix')}
					class={[
						'rounded-full border px-3 py-1 text-sm',
						data.djMix === (value === 'mix')
							? 'border-amber-500 text-amber-400'
							: 'border-zinc-700 hover:bg-zinc-900'
					]}>{label}</button
				>
			{/each}
		</form>
	</section>
{/if}
