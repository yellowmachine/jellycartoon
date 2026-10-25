<script lang="ts">
	import { enhance } from '$app/forms';
	import { section, select, secondary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Etiquetas de los capítulos: sus conjuntos, para Ollama. */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();
</script>

{#if data.labels}
	<section class={section} id="etiquetas">
		<h2 class="mb-1 font-semibold">Etiquetas de los capítulos</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Conjuntos de etiquetas que el modelo de visión ({data.labels.model}, en Ollama) busca en los
			fotogramas: al seleccionar capítulos en una serie, «Etiquetar con» uno de ellos. Luego se
			puede filtrar la serie por lo que vio, y el avance está en Gestión → Etiquetado. Solo tú ves
			esta sección.
		</p>
		{#snippet labelSetForm(set: { id?: number; name: string; labels: string[] } | null)}
			<form
				method="post"
				action="?seccion={tab}&/saveLabelSet"
				use:enhance={() =>
					async ({ update }) =>
						update({ reset: !set })}
				class="flex flex-col gap-2"
			>
				{#if set?.id}<input type="hidden" name="id" value={set.id} />{/if}
				<input
					name="name"
					required
					maxlength="40"
					value={set?.name ?? ''}
					placeholder="Animales"
					aria-label="Nombre del conjunto"
					class="{select} min-w-0"
				/>
				<textarea
					name="labels"
					rows="2"
					required
					value={set?.labels.join(', ') ?? ''}
					placeholder="perro, gato, caballo, pájaro"
					aria-label="Etiquetas, separadas por comas"
					class="{select} w-full"></textarea>
				<div class="flex items-center gap-3">
					<button class={secondary}>{set ? 'Guardar' : 'Crear conjunto'}</button>
					{#if set?.id}
						<button
							formaction="?seccion={tab}&/deleteLabelSet"
							formnovalidate
							class="text-sm text-red-400 hover:underline">Borrar</button
						>
					{/if}
				</div>
			</form>
		{/snippet}
		{#if data.labels.sets.length}
			<ul class="mb-4 divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
				{#each data.labels.sets as set (set.id)}
					<li>
						<details>
							<summary class="flex cursor-pointer items-center gap-3 p-2">
								<span class="shrink-0 font-medium">{set.name}</span>
								<span class="min-w-0 flex-1 truncate text-zinc-400">{set.labels.join(', ')}</span>
							</summary>
							<div class="border-t border-zinc-800 p-3">{@render labelSetForm(set)}</div>
						</details>
					</li>
				{/each}
			</ul>
		{/if}
		<h3 class="mb-2 text-sm text-zinc-300">Nuevo conjunto</h3>
		{@render labelSetForm(null)}
		<p class="mt-2 text-xs text-zinc-500">
			Cambiar un conjunto no toca lo ya etiquetado: etiqueta esos capítulos otra vez. Borrarlo quita
			también lo que vio con él.
		</p>
		{#if form && 'section' in form && form.section === 'labels'}
			<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
		{:else if form && 'saved' in form && form.saved === 'labelSet'}
			<p class="mt-3 text-sm text-amber-400">✓ Guardado</p>
		{/if}
	</section>
{/if}
