<script lang="ts">
	import MusicBackgroundSettings from 'comun/components/MusicBackgroundSettings.svelte';
	import { section } from '#lib/styles.ts';

	/** El fondo de Música en este aparato (#253), como en jellycartoon. */
</script>

<section class={section} id="fondo-musica">
	<h2 class="mb-1 font-semibold">Fondo de Música</h2>
	<p class="mb-4 text-sm text-zinc-400">
		Formas con los colores de la portada de lo que suena, detrás de las páginas de Música. Se mueven
		mientras suena. Solo en este dispositivo: la tablet puede tener uno y el móvil ninguno.
	</p>
	<MusicBackgroundSettings />
</section>
