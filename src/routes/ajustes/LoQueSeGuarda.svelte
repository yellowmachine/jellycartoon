<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Lo que se guarda de ti: lo que ves (#84); tus viajes, en la nube (#253). */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.keepHistory !== null}
	<section class={section} id="lo-que-veo">
		<h2 class="mb-1 font-semibold">Lo que se guarda de ti</h2>
		<form
			method="post"
			action="?seccion={tab}&/history"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<label class="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					name="keepHistory"
					checked={data.keepHistory}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					Guardar lo que veo
					<span class="block text-xs text-zinc-500"
						>Qué series, películas y canales ves, cuánto rato y a qué horas{data.voice
							? ', para preguntárselo a la IA en Hablar («¿qué capítulo vi el viernes?»)'
							: ''}. Solo lo puedes consultar tú. Apagarlo no borra lo ya guardado.</span
					>
				</span>
			</label>
		</form>
	</section>
{/if}
