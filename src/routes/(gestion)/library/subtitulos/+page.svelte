<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { poll } from '#lib/poll.ts';
	import { formatRemaining } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const queue = $derived(data.queue);

	const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });

	// While something is made or waits.
	$effect(() => {
		if (!queue.running && !queue.queued.length) return;
		return poll(invalidateAll, 3000);
	});
</script>

{#snippet jobButton(action: string, id: number, label: string)}
	<form method="post" action="?/{action}" use:enhance>
		<input type="hidden" name="id" value={id} />
		<button class="shrink-0 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-900">
			{label}
		</button>
	</form>
{/snippet}

{#snippet queueButton(action: string, label: string)}
	<form method="post" action="?/{action}" use:enhance>
		<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
			{label}
		</button>
	</form>
{/snippet}

{#snippet what(job: { title: string; detail: string; href: string; language: string })}
	<p class="min-w-0 flex-1 truncate">
		<a href={job.href} class="hover:text-amber-400">{job.title}</a>
		<span class="block truncate text-xs text-zinc-500">{job.detail} · {job.language}</span>
	</p>
{/snippet}

<h1 class="mb-2 text-2xl font-bold">Subtítulos</h1>
<p class="mb-6 text-sm text-zinc-400">
	Los automáticos que hace Whisper, de uno en uno, para el audio sin subtítulos propios. Se piden
	desde el menú de cada capítulo, al seleccionar capítulos de una serie o en la página de cada
	película.
</p>

{#if !queue.available}
	<p class="text-sm text-zinc-500">
		No hay Whisper configurado (WHISPER_URL): sin él no se pueden hacer subtítulos automáticos.
	</p>
{:else}
	<section class="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 p-3">
		<p class="mr-auto text-sm">
			Cola:
			<strong class:text-amber-400={queue.paused}>{queue.paused ? 'En pausa' : 'En marcha'}</strong>
			<span class="text-zinc-400">
				· {queue.queued.length === 1 ? '1 esperando' : `${queue.queued.length} esperando`}
			</span>
			{#if queue.paused && queue.running}
				<span class="block text-xs text-zinc-400"
					>Termina el que está haciendo y no empieza otro.</span
				>
			{/if}
		</p>
		{@render queueButton(queue.paused ? 'resume' : 'pause', queue.paused ? 'Reanudar' : 'Pausar')}
		{#if queue.queued.length}
			{@render queueButton('cancelAll', 'Cancelar los que esperan')}
		{/if}
	</section>

	{#if queue.running}
		{@const job = queue.running}
		<section class="mb-6 rounded-md border border-zinc-800 p-3 text-sm">
			<div class="flex items-center gap-2">
				{@render what(job)}
				{@render jobButton('cancel', job.id, 'Cancelar')}
			</div>
			<div class="mt-2 h-1.5 rounded bg-zinc-800">
				<div
					class="h-full rounded bg-amber-400"
					style:width="{job.total ? (job.done / job.total) * 100 : 0}%"
				></div>
			</div>
			<p class="mt-1 text-xs text-zinc-400">
				{job.total ? `${job.done} de ${job.total} trozos` : 'Sacando el audio…'} · desde hace
				{formatRemaining(job.elapsedSec)}
			</p>
		</section>
	{/if}

	{#if queue.failed.length}
		<details class="mb-6 rounded-md border border-zinc-800" open>
			<summary class="cursor-pointer p-3 text-sm text-red-400">
				Fallidos ({queue.failed.length})
			</summary>
			<ul class="max-h-96 divide-y divide-zinc-800 overflow-auto border-t border-zinc-800">
				{#each queue.failed as job (job.id)}
					<li class="p-3 text-sm">
						<div class="flex items-center gap-2">
							{@render what(job)}
							{@render jobButton('retry', job.id, 'Reintentar')}
							{@render jobButton('dismiss', job.id, 'Descartar')}
						</div>
						<p class="mt-1 text-xs break-words text-red-400">{job.error}</p>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if queue.queued.length}
		<details class="mb-6 rounded-md border border-zinc-800" open>
			<summary class="cursor-pointer p-3 text-sm">En cola ({queue.queued.length})</summary>
			<ol class="max-h-[32rem] divide-y divide-zinc-800 overflow-auto border-t border-zinc-800">
				{#each queue.queued as job, i (job.id)}
					<li class="flex items-center gap-2 p-3 text-sm">
						<span class="w-6 shrink-0 text-right text-xs text-zinc-500">{i + 1}</span>
						{@render what(job)}
						{#if i > 0}
							{@render jobButton('first', job.id, 'Ponerlo el primero')}
						{/if}
						{@render jobButton('cancel', job.id, 'Quitar')}
					</li>
				{/each}
			</ol>
		</details>
	{/if}

	{#if queue.done.length}
		<details class="rounded-md border border-zinc-800">
			<summary class="cursor-pointer p-3 text-sm text-zinc-400">
				Hechos últimamente ({queue.done.length})
			</summary>
			<ul class="max-h-96 divide-y divide-zinc-800 overflow-auto border-t border-zinc-800">
				{#each queue.done as job (job.id)}
					<li class="flex items-center gap-2 p-3 text-sm">
						{@render what(job)}
						<span class="shrink-0 text-xs text-zinc-500">
							{job.cues} frases{job.finishedAt ? ` · ${dateTime.format(job.finishedAt)}` : ''}
						</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if !queue.running && !queue.queued.length && !queue.failed.length && !queue.done.length}
		<p class="text-sm text-zinc-500">Todavía no se ha pedido ningún subtítulo automático.</p>
	{/if}
{/if}
