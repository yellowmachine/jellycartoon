<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/** «Guardar mis viajes» (#81, #84): what the road mode keeps of where one goes, only if asked. */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

<section class={section} id="viajes">
	<h2 class="mb-1 font-semibold">Tus viajes</h2>
	<form
		method="post"
		action="?seccion={tab}&/recordTrips"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
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
					>Con el modo carretera abierto, por dónde vas: cada viaje con su recorrido, distancia y
					tiempo, y los km al mes. Solo los ves tú, en <a
						href="/viajes"
						class="text-amber-400 hover:underline">Viajes</a
					>, donde se borran. Apagarlo no borra lo ya guardado.</span
				>
			</span>
		</label>
	</form>
</section>
