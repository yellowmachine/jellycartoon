<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { formatDuration } from '../format.ts';
	import { music } from '../music-player.svelte.ts';
	import MediaIcon from './MediaIcon.svelte';

	/**
	 * Música → Cola, in jellycartoon and in Seilide: what is on, what comes next and what already
	 * played (dimmed: it is still the queue, and «anterior» or repeat go back to it). A song touched
	 * plays; ✕ takes it out. It was a panel under the player, opened by an icon that was missed.
	 */

	/**
	 * The queue saved as a new list, as it is now (albums added, songs taken away or moved): the
	 * library's songs only, not the DJ's words nor what plays from its own address (Oración, «Tu
	 * música»).
	 */
	const queueSongs = $derived(music.queue.filter((t) => !t.clip && !t.src));
	let saving = $state<'naming' | 'saving' | null>(null);
	let saved = $state<{ id: number; name: string } | null>(null);
	let problem = $state<string | null>(null);

	async function saveQueue(e: SubmitEvent) {
		e.preventDefault();
		const name = String(new FormData(e.currentTarget as HTMLFormElement).get('name') ?? '').trim();
		if (!name) return;
		saving = 'saving';
		problem = null;
		const res = await fetch('/api/music/playlists', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name, trackIds: queueSongs.map((t) => t.id) })
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		if (!res?.ok) {
			saving = 'naming';
			problem = body?.message ?? 'Sin conexión';
			return;
		}
		saving = null;
		saved = { id: body.playlistId, name };
		// The new list shows up in every «+» and in Listas.
		await invalidateAll();
	}

	let list = $state<HTMLElement>();
	// Opened: the one on in view, not the start of a long queue.
	$effect(() => {
		list?.querySelector('[aria-current]')?.scrollIntoView({ block: 'center' });
	});

	const totalSec = $derived(music.queue.reduce((sum, t) => sum + (t.durationSec ?? 0), 0));
</script>

<h1 class="mb-1 text-2xl font-bold">Cola</h1>
{#if music.radio || !music.queue.length}
	<p class="mt-4 text-zinc-400">
		{music.radio
			? 'Ahora suena la radio: no tiene cola.'
			: 'No hay nada en la cola. Pon un disco, una lista o una carpeta, o añade canciones con «Añadir a la cola».'}
	</p>
{:else}
	<p class="mb-4 text-sm text-zinc-400">
		{music.queue.length}
		{music.queue.length === 1 ? 'canción' : 'canciones'} · {formatDuration(totalSec)}. Toca una para
		ponerla.
	</p>

	{#if queueSongs.length}
		<div class="mb-4 flex flex-wrap items-center gap-2 text-sm">
			{#if saving}
				<form class="flex max-w-md min-w-0 flex-1 gap-2" onsubmit={saveQueue}>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						name="name"
						placeholder="Nombre de la lista"
						aria-label="Nombre de la lista nueva"
						maxlength="100"
						autofocus
						class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900 text-sm"
					/>
					<button
						class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
						disabled={saving === 'saving'}>{saving === 'saving' ? 'Guardando…' : 'Guardar'}</button
					>
					<button
						type="button"
						class="text-zinc-400 hover:text-white"
						onclick={() => ((saving = null), (problem = null))}>Cancelar</button
					>
				</form>
			{:else}
				<button
					class="rounded-md border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800"
					onclick={() => ((saving = 'naming'), (saved = null))}
					>Guardar como lista nueva ({queueSongs.length}
					{queueSongs.length === 1 ? 'canción' : 'canciones'})</button
				>
				{#if saved}
					<a href="/musica/listas/{saved.id}" class="text-zinc-400 hover:text-white"
						>✓ Guardada: {saved.name}</a
					>
				{/if}
			{/if}
			{#if problem}
				<p class="w-full text-xs text-red-400">{problem}</p>
			{/if}
		</div>
	{/if}

	<ol
		bind:this={list}
		class="divide-y divide-zinc-800 rounded-md border border-zinc-800"
		aria-label="Cola"
	>
		{#each music.queue as t, i (`${i}:${t.id}`)}
			<li class="flex items-center">
				<button
					class={[
						'flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left hover:bg-zinc-900',
						i === music.index ? 'text-amber-400' : i < music.index && 'text-zinc-500'
					]}
					aria-current={i === music.index ? 'true' : undefined}
					onclick={() => music.jumpTo(i)}
				>
					<span class="w-6 shrink-0 text-right font-mono text-xs tabular-nums"
						>{i === music.index ? '♪' : i + 1}</span
					>
					<span class="min-w-0 flex-1">
						<span class="block truncate">{t.title}</span>
						<span class="block truncate text-sm text-zinc-500">{t.artist}</span>
					</span>
					<span class="font-mono text-xs text-zinc-500 tabular-nums"
						>{formatDuration(t.durationSec)}</span
					>
				</button>
				{#if i !== music.index}
					<button
						class="mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-white"
						aria-label="Quitar {t.title} de la cola"
						title="Quitar de la cola"
						onclick={() => music.remove(i)}><MediaIcon name="close" class="h-3.5 w-3.5" /></button
					>
				{:else}
					<span class="mr-1 w-10 shrink-0" aria-hidden="true"></span>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
