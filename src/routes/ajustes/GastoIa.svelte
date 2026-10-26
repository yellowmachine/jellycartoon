<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Gasto del mes en la IA: lo de este mes, en una línea bajo la cabecera (#193). */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

{#if data.spendLine !== null}
	<section class={section} id="gasto-ia">
		<h2 class="mb-1 font-semibold">Gasto del mes</h2>
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
					Mostrar el gasto del mes bajo la cabecera
					<span class="block text-xs text-zinc-500"
						>En todas las páginas, una línea con lo que lleva gastado la casa en OpenRouter este mes
						y el crédito que queda. Se actualiza sola: con cada uso de la IA, y con la cifra de
						OpenRouter cada pocos minutos.</span
					>
				</span>
			</label>
		</form>
	</section>
{/if}
