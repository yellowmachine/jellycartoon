<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { poll } from 'comun/poll.ts';
	import { formatBytes, formatRemaining } from 'comun/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const inbox = $derived(data.inbox);

	const time = new Intl.DateTimeFormat('es', { timeStyle: 'short' });
	const dateTime = new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' });

	// While something is encoded or waits.
	$effect(() => {
		if (!inbox.current && !inbox.queue.length) return;
		return poll(invalidateAll, 5000);
	});

	const percent = $derived(
		inbox.current?.durationSec ? (inbox.current.doneSec / inbox.current.durationSec) * 100 : 0
	);
	/** Encoding time left, at the speed it goes (not counting pauses). */
	const left = $derived(
		inbox.current?.speed && inbox.current.durationSec
			? (inbox.current.durationSec - inbox.current.doneSec) / inbox.current.speed
			: null
	);
</script>

{#snippet button(action: string, label: string, name?: string)}
	<form method="post" action="?/{action}" use:enhance>
		{#if name}<input type="hidden" name="name" value={name} />{/if}
		<button
			class="shrink-0 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
		>
			{label}
		</button>
	</form>
{/snippet}

<h1 class="mb-2 text-2xl font-bold">Entrada de Cine</h1>
<p class="mb-6 text-sm text-zinc-400">
	Las películas recién ripeadas (con MakeMKV) se dejan en la carpeta
	<code class="text-zinc-300">{inbox.folder}</code> dentro de la de Cine. Cuando terminan de copiarse,
	se pasan a HEVC (mucho más pequeñas, sin que se note), con todos sus audios y subtítulos, y van a Cine.
	Una a una y solo mientras nadie usa el salón: se para sola si se pone algo en el salón, se juega o el
	ordenador trabaja, y sigue 10 minutos después. Las que ya son HEVC pasan tal cual.
</p>

{#if !inbox.enabled}
	<p class="text-sm text-zinc-500">No hay carpeta de Cine (HOST_CINEMA_DIR).</p>
{:else if inbox.problem}
	<p class="text-sm text-red-400">{inbox.problem}</p>
{:else}
	<section class="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-zinc-800 p-3">
		<p class="mr-auto text-sm">
			{#if inbox.paused}
				<strong class="text-amber-400">En pausa</strong>
				<span class="block text-xs text-zinc-400">No codifica nada hasta que la reanudes.</span>
			{:else if inbox.waiting && (inbox.current || inbox.queue.some((f) => !f.copying))}
				<strong class="text-amber-400">Esperando</strong>
				<span class="block text-xs text-zinc-400">
					Se está usando el salón ({inbox.waiting.why}): sigue a las {time.format(
						inbox.waiting.until
					)} si nadie lo usa.
				</span>
			{:else if inbox.current}
				<strong>Codificando</strong>
			{:else}
				<strong>En marcha</strong>
				<span class="text-zinc-400">
					· {inbox.queue.length ? 'esperando a que terminen de copiarse' : 'nada en la carpeta'}
				</span>
			{/if}
		</p>
		{@render button(inbox.paused ? 'resume' : 'pause', inbox.paused ? 'Reanudar' : 'Pausar')}
	</section>

	{#if inbox.current}
		{@const job = inbox.current}
		<section class="mb-6 rounded-md border border-zinc-800 p-3 text-sm">
			<div class="flex items-center gap-2">
				<p class="min-w-0 flex-1 truncate">{job.name}</p>
				{@render button('cancel', 'Cancelar')}
			</div>
			<div class="mt-2 h-1.5 rounded bg-zinc-800">
				<div
					class="h-full rounded {job.frozen ? 'bg-zinc-500' : 'bg-amber-400'}"
					style:width="{percent}%"
				></div>
			</div>
			<p class="mt-1 text-xs text-zinc-400">
				{Math.floor(percent)} %{job.frozen ? ' · en pausa' : ''}
				{#if job.speed}
					· {job.speed.toFixed(2)}× tiempo real{left !== null
						? ` · quedan unas ${formatRemaining(left)} de codificar`
						: ''}
				{/if}
			</p>
		</section>
	{/if}

	{#if inbox.failed.length}
		<details class="mb-6 rounded-md border border-zinc-800" open>
			<summary class="cursor-pointer p-3 text-sm text-red-400">
				No se pudieron pasar ({inbox.failed.length})
			</summary>
			<ul class="divide-y divide-zinc-800 border-t border-zinc-800">
				{#each inbox.failed as file (file.name)}
					<li class="p-3 text-sm">
						<div class="flex items-center gap-2">
							<p class="min-w-0 flex-1 truncate">{file.name}</p>
							{@render button('retry', 'Reintentar', file.name)}
						</div>
						<p class="mt-1 text-xs break-words text-red-400">{file.error}</p>
						<p class="text-xs text-zinc-500">
							Sigue en la carpeta {inbox.folder}. Si lo copias de nuevo, se vuelve a intentar.
						</p>
					</li>
				{/each}
			</ul>
		</details>
	{/if}

	{#if inbox.queue.length}
		<details class="mb-6 rounded-md border border-zinc-800" open>
			<summary class="cursor-pointer p-3 text-sm">En la carpeta ({inbox.queue.length})</summary>
			<ol class="divide-y divide-zinc-800 border-t border-zinc-800">
				{#each inbox.queue as file (file.name)}
					<li class="flex items-center gap-2 p-3 text-sm">
						<p class="min-w-0 flex-1 truncate">{file.name}</p>
						<span class="shrink-0 text-xs text-zinc-500">
							{formatBytes(file.size)}{file.copying ? ' · copiándose' : ''}
						</span>
					</li>
				{/each}
			</ol>
		</details>
	{/if}

	{#if inbox.done.length}
		<details class="rounded-md border border-zinc-800">
			<summary class="cursor-pointer p-3 text-sm text-zinc-400">
				Pasadas a Cine ({inbox.done.length})
			</summary>
			<ul class="divide-y divide-zinc-800 border-t border-zinc-800">
				{#each inbox.done as file (file.at)}
					<li class="flex items-center gap-2 p-3 text-sm">
						<p class="min-w-0 flex-1 truncate">{file.name}</p>
						<span class="shrink-0 text-xs text-zinc-500">
							{file.encoded
								? `${formatBytes(file.fromBytes)} → ${formatBytes(file.toBytes)}`
								: 'tal cual'} · {dateTime.format(new Date(file.at))}
						</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
{/if}
