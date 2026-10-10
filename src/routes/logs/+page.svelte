<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const levelStyle = {
		info: 'text-zinc-400',
		warn: 'text-amber-400',
		error: 'text-red-400'
	};
	const levelLabel = { info: 'info', warn: 'aviso', error: 'error' };

	/** Same filters, older entries. */
	const olderHref = $derived.by(() => {
		const params = new URLSearchParams(page.url.search);
		params.set('before', String(data.entries.at(-1)?.id ?? ''));
		return `?${params}`;
	});
	const newestHref = $derived.by(() => {
		const params = new URLSearchParams(page.url.search);
		params.delete('before');
		return `?${params}`;
	});

	const select = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
</script>

<svelte:head>
	<title>Registro · JellyCartoon</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-bold">Registro</h1>

<form method="get" class="mb-4 flex flex-wrap items-center gap-3">
	<select
		name="level"
		value={data.filters.level}
		aria-label="Nivel"
		class={select}
		onchange={(e) => e.currentTarget.form?.requestSubmit()}
	>
		<option value="">Todo</option>
		<option value="warn">Avisos y errores</option>
		<option value="error">Solo errores</option>
	</select>
	<select
		name="source"
		value={data.filters.source}
		aria-label="Origen"
		class={select}
		onchange={(e) => e.currentTarget.form?.requestSubmit()}
	>
		<option value="">Cualquier origen</option>
		{#each data.sources as source (source)}
			<option value={source}>{source}</option>
		{/each}
	</select>
	<input
		type="date"
		name="day"
		value={data.filters.day}
		aria-label="Día"
		class={select}
		onchange={(e) => e.currentTarget.form?.requestSubmit()}
	/>
	<input
		type="search"
		name="q"
		value={data.filters.q}
		placeholder="Buscar en el mensaje"
		aria-label="Buscar en el mensaje"
		class="{select} min-w-0 flex-1"
	/>
	<button class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950">
		Filtrar
	</button>
	{#if page.url.search}
		<a href="/logs" class="text-sm text-zinc-400 hover:text-white">Quitar filtros</a>
	{/if}
</form>

{#if data.entries.length === 0}
	<p class="text-zinc-400">No hay nada con estos filtros.</p>
{:else}
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800 text-sm">
		{#each data.entries as entry (entry.id)}
			<li>
				<details class="group">
					<summary
						class={[
							'flex cursor-pointer list-none items-baseline gap-3 px-3 py-2 hover:bg-zinc-900',
							!entry.details && 'cursor-default'
						]}
					>
						<span class="shrink-0 font-mono text-xs text-zinc-500 tabular-nums">{entry.at}</span>
						<span class={['w-10 shrink-0 text-xs', levelStyle[entry.level]]}>
							{levelLabel[entry.level]}
						</span>
						<span class="w-20 shrink-0 truncate text-xs text-zinc-400">{entry.source}</span>
						<span class="min-w-0 flex-1 truncate group-open:whitespace-normal">
							{entry.message}
						</span>
					</summary>
					{#if entry.details}
						<pre
							class="mx-3 mb-3 max-h-96 overflow-auto rounded bg-zinc-900 p-3 font-mono text-xs whitespace-pre-wrap text-zinc-300">{JSON.stringify(
								entry.details,
								null,
								2
							).replaceAll('\\n', '\n')}</pre>
					{/if}
				</details>
			</li>
		{/each}
	</ul>

	<div class="mt-4 flex justify-between text-sm">
		{#if data.filters.before}
			<a href={newestHref} class="text-amber-400 hover:underline">← Más recientes</a>
		{:else}
			<span></span>
		{/if}
		{#if data.hasMore}
			<a href={olderHref} class="text-amber-400 hover:underline">Más antiguos →</a>
		{/if}
	</div>
{/if}
