<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** El gasto en la IA, en una línea bajo la cabecera (#193). */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.spendLine !== null}
	<section class={section} id="gasto-ia">
		<h2 class="mb-1 font-semibold">Línea de gasto</h2>
		<form
			method="post"
			action="?seccion={tab}&/spendLine"
			use:enhance={() =>
				async ({ update }) =>
					update({ reset: false })}
		>
			<label class="flex items-start gap-2 text-sm">
				<input
					type="checkbox"
					name="spendLine"
					checked={data.spendLine}
					onchange={(e) => e.currentTarget.form?.requestSubmit()}
					class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
				/>
				<span>
					Mostrar el gasto en IA bajo la cabecera
					<span class="block text-xs text-zinc-500"
						>En todas las páginas, una línea con lo que lleva gastado la casa en OpenRouter (en
						total, este mes y esta semana) y lo que costaron los tres últimos usos. Se actualiza
						sola: con cada uso de la IA, y con las cifras de OpenRouter cada pocos minutos.</span
					>
				</span>
			</label>
		</form>
	</section>
{/if}
