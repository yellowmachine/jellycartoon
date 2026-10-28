<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDuration } from 'comun/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** In the generator, what each tag does; tags not here do not count. */
	let tagMode = $state<Record<number, 'include' | 'exclude'>>({});
	/** Clicking a tag goes: does not count → only these → never these → does not count. */
	function cycle(id: number) {
		if (!tagMode[id]) tagMode[id] = 'include';
		else if (tagMode[id] === 'include') tagMode[id] = 'exclude';
		else delete tagMode[id];
	}
	let generating = $state(false);
</script>

<h1 class="mb-1 text-2xl font-bold">Listas</h1>
<p class="mb-6 text-zinc-400">
	Crea una lista y déjala activa: en la página de cada serie podrás añadirle capítulos.
</p>

<form method="post" action="?/create" use:enhance class="mb-2 flex max-w-md gap-2">
	<input
		name="name"
		placeholder="Nombre de la lista nueva"
		aria-label="Nombre de la lista nueva"
		class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 text-sm"
	/>
	<button class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400">
		Crear
	</button>
</form>
{#if form?.message && !('generate' in form)}
	<p class="text-sm text-red-400">{form.message}</p>
{/if}

<details
	class="mt-6 max-w-2xl rounded-md border border-zinc-800 p-4"
	open={Boolean(form && 'generate' in form)}
>
	<summary class="cursor-pointer font-medium">Generar una lista por etiquetas</summary>
	<form
		method="post"
		action="?/generate"
		use:enhance={() => {
			generating = true;
			return async ({ update }) => {
				await update();
				generating = false;
			};
		}}
		class="mt-4 space-y-4 text-sm"
	>
		<p class="text-zinc-400">
			Mezcla capítulos de varias series como la lista de Hoy, siguiendo las de continuidad por donde
			ibas, pero solo de las series que dejan las etiquetas.
		</p>
		<div class="flex flex-wrap gap-3">
			<input
				name="name"
				placeholder="Nombre (p. ej. Sobrinos)"
				aria-label="Nombre de la lista"
				class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 text-sm"
			/>
			<label class="flex items-center gap-2">
				<input
					type="number"
					name="minutes"
					value="90"
					min="5"
					max="600"
					step="5"
					required
					class="w-20 rounded-md border-zinc-700 bg-zinc-900 text-sm"
				/>
				minutos
			</label>
		</div>
		{#if data.tags.length}
			<div>
				<p class="mb-2 text-zinc-400">
					Pulsa una etiqueta para elegir
					<span class="text-emerald-400">solo series con ella</span>, otra vez para
					<span class="text-red-400">ninguna serie con ella</span>, y otra para que no cuente.
				</p>
				<div class="flex flex-wrap gap-2">
					{#each data.tags as tag (tag.id)}
						{@const mode = tagMode[tag.id]}
						<button
							type="button"
							class={[
								'rounded-full border px-3 py-0.5',
								mode === 'include' && 'border-emerald-600 bg-emerald-950 text-emerald-300',
								mode === 'exclude' && 'border-red-700 bg-red-950 text-red-300 line-through',
								!mode && 'border-zinc-700 text-zinc-300 hover:bg-zinc-900'
							]}
							aria-label="{tag.name}: {mode === 'include'
								? 'solo series con ella'
								: mode === 'exclude'
									? 'ninguna serie con ella'
									: 'no cuenta'}"
							onclick={() => cycle(tag.id)}
						>
							{mode === 'include' ? '✓ ' : mode === 'exclude' ? '✕ ' : ''}{tag.name}
							<span class="text-xs opacity-60">{tag.series}</span>
						</button>
						{#if mode}
							<input type="hidden" name={mode} value={tag.id} />
						{/if}
					{/each}
				</div>
			</div>
		{:else}
			<p class="text-zinc-500">
				Aún no hay etiquetas: ponlas en la página de cada serie (p. ej. «infantil»).
			</p>
		{/if}
		{#if form?.message && 'generate' in form}
			<p class="text-red-400">{form.message}</p>
		{/if}
		<button
			disabled={generating}
			class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		>
			{generating ? 'Generando…' : 'Generar'}
		</button>
	</form>
</details>

{#if data.lists.length}
	<ul class="mt-6 divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.lists as list (list.id)}
			{@const active = list.id === data.activeId}
			<li class="flex items-center gap-3 pr-3">
				<a href="/lists/{list.id}" class="min-w-0 flex-1 p-3 hover:bg-zinc-900">
					<p class="truncate">
						{list.name}
						{#if active}<span class="ml-1 text-xs text-amber-400">· activa</span>{/if}
					</p>
					<p class="text-xs text-zinc-400">
						{#if list.total}
							{list.total} capítulos · {formatDuration(list.durationSec)}
							{#if list.pending < list.total}· quedan {list.pending}{/if}
						{:else}
							Vacía
						{/if}
					</p>
				</a>
				{#if !active}
					<form method="post" action="?/activate" use:enhance>
						<input type="hidden" name="id" value={list.id} />
						<button class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900">
							Activar
						</button>
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
