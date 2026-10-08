<script lang="ts">
	import { enhance } from '$app/forms';
	import TitleForm from '#lib/components/TitleForm.svelte';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let confirmDelete = $state(false);
	/** What is being renamed: the series, an episode id, or nothing. */
	let editing = $state<'series' | number | null>(null);
	let inList = $derived(new Set(data.inList));
</script>

{#snippet editButton(target: 'series' | number, label: string)}
	<button
		class="shrink-0 rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
		title={label}
		aria-label={label}
		onclick={() => (editing = target)}>✎</button
	>
{/snippet}

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	{#if editing === 'series'}
		<TitleForm action="?/renameSeries" value={data.series.title} onclose={() => (editing = null)} />
	{:else}
		<h1 class="flex items-center gap-2 text-2xl font-bold">
			{data.series.title}
			{@render editButton('series', 'Cambiar título de la serie')}
		</h1>
	{/if}
	<form method="post" action="?/serialized" use:enhance class="text-sm">
		<input type="hidden" name="serialized" value={String(!data.series.serialized)} />
		<button class="flex items-center gap-2 text-zinc-400 hover:text-white">
			<span
				class={[
					'relative h-5 w-9 rounded-full transition',
					data.series.serialized ? 'bg-amber-500' : 'bg-zinc-700'
				]}
			>
				<span
					class={[
						'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
						data.series.serialized ? 'left-4.5' : 'left-0.5'
					]}
				></span>
			</span>
			{data.series.serialized ? 'Con continuidad: en orden' : 'Episodios sueltos: al azar'}
		</button>
	</form>
</div>
{#if form?.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}

<p class="mb-2 text-sm text-zinc-400">
	{#if data.activeList}
		Añadiendo a la lista
		<a href="/lists/{data.activeList.id}" class="text-amber-400 hover:underline"
			>{data.activeList.name}</a
		>
	{:else}
		<a href="/lists" class="hover:text-white">Activa una lista</a> para añadirle capítulos de esta serie.
	{/if}
</p>

{#each data.seasons as { season, episodes } (season)}
	<h2 class="mt-6 mb-3 font-semibold text-zinc-300">Temporada {season}</h2>
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each episodes as ep (ep.id)}
			{@const ready = ep.status === 'ready'}
			<li class="flex items-center pr-3">
				{#if editing === ep.id}
					<div class="flex min-w-0 flex-1 items-center gap-3 p-3">
						<span class="shrink-0 text-zinc-400">{ep.number}.</span>
						<TitleForm
							action="?/renameEpisode"
							value={ep.title}
							placeholder={ep.autoTitle}
							hidden={{ id: ep.id }}
							onclose={() => (editing = null)}
						/>
					</div>
				{:else}
					<svelte:element
						this={ready ? 'a' : 'div'}
						href={ready ? `/watch/${ep.id}` : undefined}
						class={[
							'flex min-w-0 flex-1 items-center gap-4 p-3',
							ready ? 'hover:bg-zinc-900' : 'opacity-60'
						]}
					>
						<div class="relative aspect-video w-32 shrink-0 overflow-hidden rounded bg-zinc-800">
							{#if ready}
								<img
									src="/api/thumb/{ep.id}"
									alt=""
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							{/if}
							{#if ep.positionSec && ep.durationSec}
								<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
									<div
										class="h-full bg-amber-400"
										style:width="{ep.completed ? 100 : (ep.positionSec / ep.durationSec) * 100}%"
									></div>
								</div>
							{/if}
						</div>
						<div class="min-w-0 flex-1">
							<p class="truncate">{ep.number}. {ep.title}</p>
							<p class="text-xs text-zinc-400">
								{#if ready}
									{formatDuration(ep.durationSec)}{#if ep.completed}
										· visto{/if}
								{:else if ep.status === 'processing'}
									Convirtiendo… {Math.round(ep.progress * 100)}%
								{:else if ep.status === 'error'}
									<span class="text-red-400">Error al convertir</span>
								{:else}
									En cola
								{/if}
							</p>
						</div>
					</svelte:element>
					{#if ready && data.activeList}
						{@const added = inList.has(ep.id)}
						<form method="post" action="?/toggleList" use:enhance>
							<input type="hidden" name="id" value={ep.id} />
							<button
								class={[
									'shrink-0 rounded-md border px-2 py-1 text-xs',
									added
										? 'border-amber-500/60 text-amber-400 hover:border-red-500/60 hover:text-red-400'
										: 'border-zinc-700 text-zinc-300 hover:bg-zinc-900'
								]}
								title={added
									? `Quitar de «${data.activeList.name}»`
									: `Añadir a «${data.activeList.name}»`}
							>
								{added ? '✓ En la lista' : '+ Lista'}
							</button>
						</form>
					{/if}
					{@render editButton(ep.id, 'Cambiar título del capítulo')}
				{/if}
			</li>
		{/each}
	</ul>
{/each}

<section class="mt-10 border-t border-zinc-800 pt-6">
	{#if confirmDelete}
		<p class="mb-3 text-sm text-zinc-400">
			Se borran {data.stored.episodes} episodios convertidos ({formatBytes(
				data.stored.outputBytes
			)}) y el progreso de visionado. Los originales no se tocan: si siguen en la carpeta de medios,
			la serie volverá en el próximo escaneo.
		</p>
		<form method="post" action="?/delete" use:enhance class="flex items-center gap-2">
			<button class="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500">
				Sí, borrar la serie
			</button>
			<button
				type="button"
				class="rounded-md px-3 py-2 text-zinc-400 hover:text-white"
				onclick={() => (confirmDelete = false)}>Cancelar</button
			>
		</form>
	{:else}
		<button
			class="rounded-md border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900"
			onclick={() => (confirmDelete = true)}
		>
			Borrar serie
		</button>
	{/if}
</section>
