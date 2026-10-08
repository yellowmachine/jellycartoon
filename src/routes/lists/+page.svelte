<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
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
{#if form?.message}
	<p class="text-sm text-red-400">{form.message}</p>
{/if}

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
