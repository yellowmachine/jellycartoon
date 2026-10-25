<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Lo que se guarda de ti: lo que ves y tus viajes (#84). */
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
		{#if data.recordTrips !== null}
			<form
				id="guardar-viajes"
				method="post"
				action="?seccion={tab}&/recordTrips"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: false })}
				class="mt-4"
			>
				<label class="flex items-start gap-2 text-sm">
					<input
						type="checkbox"
						name="recordTrips"
						checked={data.recordTrips}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					<span>
						Guardar mis viajes
						<span class="block text-xs text-zinc-500"
							>Con el modo carretera abierto, por dónde vas: cada viaje con su recorrido, distancia
							y tiempo, y los km al mes. Solo los ves tú, en <a
								href="/viajes"
								class="text-amber-400 hover:underline">Viajes</a
							>, donde se borran. Apagarlo no borra lo ya guardado.</span
						>
					</span>
				</label>
			</form>
		{/if}
	</section>
{/if}
