<script lang="ts">
	import { enhance } from '$app/forms';
	import { vista } from '#lib/vista.svelte.ts';
	import { formatDuration } from 'comun/format.ts';
	import OfflineLists from '#lib/components/OfflineLists.svelte';
	import { ownListUrl } from '#lib/own-music.ts';
	import type { PageProps } from './$types';

	/** The playlists (#253), as jellycartoon's: the house's, or the family's own bucket's (#534). */
	let { data, form }: PageProps = $props();
</script>

<svelte:head>
	<title>Listas de música · Seilide</title>
</svelte:head>

<!-- The lists of this person's source (#534, phase 3): the house's, or the bucket's. -->
{#if !data.own}
	<p class="mb-4 text-sm text-zinc-400">
		Listas de canciones de toda la casa: cualquiera puede escucharlas y cambiarlas. Se añaden
		canciones con el «+» de cada una, en los álbumes o en el buscador.
	</p>

	<!-- Locked Vista (#532): the lists to listen to, not to make. -->
	{#if !vista.kiosk}
		<form method="post" action="?/create" use:enhance class="mb-2 flex max-w-md gap-2">
			<input
				name="name"
				placeholder="Nombre de la lista nueva"
				aria-label="Nombre de la lista nueva"
				class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 text-sm"
			/>
			<button
				class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
			>
				Crear
			</button>
		</form>
	{/if}
	{#if form && 'message' in form && form.message}
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

	{#if data.lists.length}
		<OfflineLists
			lists={data.lists}
			view={data.offline}
			problem={form && 'offline' in form ? (form.offline ?? null) : null}
		/>
	{/if}
{:else}
	<!-- The bucket's own (#534, phase 2), kept in Seilide, only with its songs. -->
	<section>
		<p class="mb-4 text-sm text-zinc-400">
			Listas de canciones de toda la familia: cualquiera puede escucharlas y cambiarlas. Se añaden
			canciones con el «+» de cada una, en los álbumes o en el buscador.
		</p>
		{#if !vista.kiosk}
			<form method="post" action="?/ownCreate" use:enhance class="mb-2 flex max-w-md gap-2">
				<input
					name="name"
					placeholder="Nombre de la lista nueva"
					aria-label="Nombre de la lista nueva"
					class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 text-sm"
				/>
				<button
					class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
				>
					Crear
				</button>
			</form>
		{/if}
		{#if form && 'ownMessage' in form}
			<p class="text-sm text-red-400">{form.ownMessage}</p>
		{/if}
		{#if data.own.length}
			<ul class="mt-6 divide-y divide-zinc-800 rounded-md border border-zinc-800">
				{#each data.own as list (list.id)}
					<li>
						<a href={ownListUrl(list.id)} class="block p-3 hover:bg-zinc-900">
							<p class="truncate">{list.name}</p>
							<p class="text-xs text-zinc-400">
								{#if list.total}
									{list.total}
									{list.total === 1 ? 'canción' : 'canciones'} · {formatDuration(list.durationSec)}
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
	</section>
{/if}
