<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Listas de música · JellyCartoon</title>
</svelte:head>

<p class="mb-4 text-sm text-zinc-400">
	Listas de canciones de toda la casa: cualquiera puede escucharlas y cambiarlas. Se añaden
	canciones con el «+» de cada una, en los álbumes o en el buscador.
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
			<li>
				<a href="/musica/listas/{list.id}" class="block p-3 hover:bg-zinc-900">
					<p class="truncate">{list.name}</p>
					<p class="text-xs text-zinc-400">
						{#if list.total}
							{list.total} canciones · {formatDuration(list.durationSec)}
						{:else}
							Vacía
						{/if}
					</p>
				</a>
			</li>
		{/each}
	</ul>
{:else}
	<p class="mt-6 text-zinc-400">Todavía no hay listas.</p>
{/if}
