<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { formatBytes, formatRemaining } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let scanning = $state(false);
	let confirmRemove = $state(false);

	const STATE_LABELS = { running: 'En marcha', paused: 'En pausa', stopped: 'Parada' };

	/** Series filter for the queue; the number shown is still the position in the whole queue. */
	let queueSeries = $state<number | null>(null);
	const queueSeriesOptions = $derived.by(() => {
		const counts = new Map<number, { title: string; count: number }>();
		for (const ep of data.queue) {
			const entry = counts.get(ep.seriesId) ?? { title: ep.seriesTitle, count: 0 };
			entry.count++;
			counts.set(ep.seriesId, entry);
		}
		return [...counts].sort(([, a], [, b]) => a.title.localeCompare(b.title));
	});
	// Once the chosen series is fully converted it leaves the queue: show everything again.
	$effect(() => {
		if (queueSeries !== null && !queueSeriesOptions.some(([id]) => id === queueSeries))
			queueSeries = null;
	});
	const visibleQueue = $derived(
		data.queue
			.map((ep, i) => ({ ...ep, position: i + 1 }))
			.filter((ep) => queueSeries === null || ep.seriesId === queueSeries)
	);

	// Refresh while something is converting.
	$effect(() => {
		if (data.totals.pending === 0 && !data.active.some((e) => e.status === 'processing')) return;
		const timer = setInterval(invalidateAll, 3000);
		return () => clearInterval(timer);
	});
</script>

{#snippet workerButton(action: string, label: string)}
	<form method="post" action="?/{action}" use:enhance>
		<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
			{label}
		</button>
	</form>
{/snippet}

<h1 class="mb-6 text-2xl font-bold">Biblioteca</h1>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<form
		method="post"
		action="?/scan"
		use:enhance={() => {
			scanning = true;
			return async ({ update }) => {
				await update();
				scanning = false;
			};
		}}
	>
		<button
			disabled={scanning}
			class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
		>
			{scanning ? 'Escaneando…' : 'Escanear carpeta'}
		</button>
	</form>
	{#if data.totals.errors}
		<form method="post" action="?/retry" use:enhance>
			<button class="rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-900">
				Reintentar errores
			</button>
		</form>
	{/if}
	{#if data.deleteSources && data.totals.removable}
		{#if confirmRemove}
			<form
				method="post"
				action="?/removeSources"
				use:enhance={() => {
					return async ({ update }) => {
						confirmRemove = false;
						await update();
					};
				}}
				class="flex items-center gap-2"
			>
				<button class="rounded-md bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-500">
					Sí, borrar {data.totals.removable} originales ({formatBytes(data.totals.removableBytes)})
				</button>
				<button
					type="button"
					class="rounded-md px-3 py-2 text-zinc-400 hover:text-white"
					onclick={() => (confirmRemove = false)}>Cancelar</button
				>
			</form>
		{:else}
			<button
				class="rounded-md border border-zinc-700 px-4 py-2 hover:bg-zinc-900"
				onclick={() => (confirmRemove = true)}
			>
				Borrar originales ya convertidos
			</button>
		{/if}
	{/if}
	{#if form && 'scan' in form && form.scan}
		<p class="text-sm text-zinc-400">
			{form.scan.series} series · {form.scan.added} nuevos · {form.scan.changed} modificados ·
			{form.scan.missing} desaparecidos
			{#if form.scan.waiting}
				<br />{form.scan.waiting} aún se están copiando: vuelve a escanear en un minuto.
			{/if}
		</p>
	{:else if form && 'removed' in form && form.removed}
		<p class="text-sm text-zinc-400">
			{form.removed.removed} originales borrados{#if form.removed.skipped}
				· {form.removed.skipped} no se tocaron (cambiaron o falta lo convertido){/if}
		</p>
	{:else if form && 'message' in form}
		<p class="text-sm text-red-400">{form.message}</p>
	{/if}
</div>

<dl class="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
	{#each [['Episodios', data.totals.total], ['Listos', data.totals.ready], ['En cola', data.totals.pending], ['Errores', data.totals.errors]] as [label, value] (label)}
		<div class="rounded-md border border-zinc-800 p-3">
			<dt class="text-xs text-zinc-400">{label}</dt>
			<dd class="text-2xl font-semibold">{value}</dd>
		</div>
	{/each}
	<div class="col-span-2 rounded-md border border-zinc-800 p-3">
		<dt class="text-xs text-zinc-400">Originales</dt>
		<dd class="text-lg">{formatBytes(data.totals.sourceBytes)}</dd>
	</div>
	<div class="col-span-2 rounded-md border border-zinc-800 p-3">
		<dt class="text-xs text-zinc-400">Convertidos</dt>
		<dd class="text-lg">{formatBytes(data.totals.outputBytes)}</dd>
	</div>
</dl>

<section class="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 p-3">
	<p class="mr-auto text-sm">
		Conversión:
		<strong class:text-amber-400={data.worker.state !== 'running'}>
			{STATE_LABELS[data.worker.state]}
		</strong>
		{#if data.queueEta}
			<span class="text-zinc-400">· quedan ≈ {formatRemaining(data.queueEta)}</span>
		{/if}
	</p>
	{#if data.worker.state === 'running'}
		{@render workerButton('pause', 'Pausar')}
	{:else}
		{@render workerButton('resume', data.worker.state === 'paused' ? 'Reanudar' : 'Iniciar')}
	{/if}
	{#if data.worker.currentId !== null}
		{@render workerButton('restart', 'Reiniciar episodio')}
	{/if}
	{#if data.worker.state !== 'stopped'}
		{@render workerButton('stop', 'Parar')}
	{/if}
</section>

{#if data.active.length}
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.active as ep (ep.id)}
			<li class="p-3 text-sm">
				<p class="truncate">
					{ep.sourcePath}
					{#if ep.status === 'processing' && data.worker.state === 'paused'}
						<span class="text-amber-400">(en pausa)</span>
					{/if}
				</p>
				{#if ep.status === 'processing'}
					<div class="mt-2 h-1.5 rounded bg-zinc-800">
						<div class="h-full rounded bg-amber-400" style:width="{ep.progress * 100}%"></div>
					</div>
				{:else}
					<pre
						class="mt-2 max-h-32 overflow-auto text-xs whitespace-pre-wrap text-red-400">{ep.error}</pre>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if data.queue.length}
	<details class="mt-6 rounded-md border border-zinc-800">
		<summary class="cursor-pointer p-3 text-sm">En cola ({data.queue.length})</summary>
		<div class="border-t border-zinc-800 p-3">
			<select
				bind:value={queueSeries}
				aria-label="Filtrar por serie"
				class="w-full rounded-md border-zinc-700 bg-zinc-900 text-sm sm:w-auto"
			>
				<option value={null}>Todas las series</option>
				{#each queueSeriesOptions as [id, { title, count }] (id)}
					<option value={id}>{title} ({count})</option>
				{/each}
			</select>
		</div>
		<ol class="max-h-96 divide-y divide-zinc-800 overflow-auto border-t border-zinc-800">
			{#each visibleQueue as ep (ep.id)}
				<li class="flex items-center gap-3 p-3 text-sm">
					<span class="w-8 shrink-0 text-right text-zinc-500">{ep.position}</span>
					<p class="min-w-0 flex-1 truncate" title={ep.sourcePath}>{ep.sourcePath}</p>
					{#if ep.position > 1}
						<form method="post" action="?/moveToFront" use:enhance>
							<input type="hidden" name="id" value={ep.id} />
							<button
								class="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900"
							>
								Siguiente
							</button>
						</form>
					{/if}
				</li>
			{/each}
		</ol>
	</details>
{/if}
