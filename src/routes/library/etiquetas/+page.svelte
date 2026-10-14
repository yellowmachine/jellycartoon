<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	/** The tag being renamed. */
	let editing = $state<number | null>(null);
	/** The tag whose deletion is being confirmed. */
	let deleting = $state<number | null>(null);
	/** Renaming to a name another tag has: waiting for «Juntar». */
	let merge = $state<{ name: string; series: number } | null>(null);
	/** The tag whose series are shown. */
	let open = $state<number | null>(null);

	function edit(id: number | null) {
		editing = id;
		merge = null;
	}
</script>

<h1 class="mb-2 text-2xl font-bold">Etiquetas</h1>
<p class="mb-6 text-sm text-zinc-400">
	Las comparten todos. Cambiar o borrar una etiqueta la cambia en todas sus series; si le pones el
	nombre de otra que ya existe, se juntan en una.
</p>

{#if !data.tags.length}
	<p class="text-sm text-zinc-500">No hay etiquetas. Se ponen desde la página de cada serie.</p>
{:else}
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.tags as t (t.id)}
			{@const error = form?.tagId === t.id ? form : null}
			<li class="p-3 text-sm">
				{#if editing === t.id}
					<form
						method="post"
						action="?/rename"
						use:enhance={() =>
							async ({ result, update }) => {
								await update({ reset: false });
								if (result.type === 'success') edit(null);
								else if (result.type === 'failure' && result.data?.merge)
									merge = result.data.merge as { name: string; series: number };
							}}
						class="flex flex-wrap items-center gap-2"
					>
						<input type="hidden" name="tagId" value={t.id} />
						{#if merge}
							<input type="hidden" name="name" value={merge.name} />
							<input type="hidden" name="merge" value="1" />
							<span class="min-w-0 flex-1">
								Ya existe «{merge.name}»: las series de «{t.name}» pasan a ella y «{t.name}»
								desaparece.
							</span>
							<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950"
								>Juntar</button
							>
						{:else}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								name="name"
								value={t.name}
								maxlength="40"
								autocomplete="off"
								aria-label="Nuevo nombre de «{t.name}»"
								autofocus
								onkeydown={(e) => e.key === 'Escape' && edit(null)}
								class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
							/>
							<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950"
								>Guardar</button
							>
						{/if}
						<button
							type="button"
							class="rounded-md px-2 py-1 text-zinc-400 hover:text-white"
							onclick={() => edit(null)}>Cancelar</button
						>
					</form>
					{#if !merge && error && 'message' in error}
						<p class="mt-1 text-red-400">{error.message}</p>
					{/if}
				{:else if deleting === t.id}
					<form
						method="post"
						action="?/delete"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								deleting = null;
							}}
						class="flex flex-wrap items-center gap-2"
					>
						<input type="hidden" name="tagId" value={t.id} />
						<span class="min-w-0 flex-1">
							¿Borrar «{t.name}»? Se quita de {t.series.length}
							{t.series.length === 1 ? 'serie' : 'series'}.
						</span>
						<button class="rounded-md bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-500"
							>Sí, borrar</button
						>
						<button
							type="button"
							class="rounded-md px-2 py-1 text-zinc-400 hover:text-white"
							onclick={() => (deleting = null)}>Cancelar</button
						>
					</form>
				{:else}
					<div class="flex items-center gap-2">
						<span class="min-w-0 flex-1 truncate">{t.name}</span>
						<button
							class="shrink-0 rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-white"
							aria-expanded={open === t.id}
							onclick={() => (open = open === t.id ? null : t.id)}
							>{t.series.length} {t.series.length === 1 ? 'serie' : 'series'}</button
						>
						<button
							class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
							title="Cambiar nombre"
							aria-label="Cambiar el nombre de «{t.name}»"
							onclick={() => {
								edit(t.id);
								deleting = null;
							}}>✎</button
						>
						<button
							class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
							title="Borrar"
							aria-label="Borrar «{t.name}»"
							onclick={() => {
								deleting = t.id;
								edit(null);
							}}>×</button
						>
					</div>
					{#if open === t.id}
						<ul class="mt-2 flex flex-wrap gap-2">
							{#each t.series as s (s.id)}
								<li>
									<a
										href="/series/{s.id}"
										class="block rounded-full border border-zinc-700 px-3 py-0.5 text-zinc-300 hover:border-zinc-500 hover:text-white"
										>{s.title}</a
									>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
			</li>
		{/each}
	</ul>
{/if}
