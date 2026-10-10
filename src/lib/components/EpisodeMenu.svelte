<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import type { AudioTrack, SubtitleTrack } from '#lib/languages.ts';
	import ActionMenu from './ActionMenu.svelte';
	import CopyPathItem from './CopyPathItem.svelte';
	import InfoDialog from './InfoDialog.svelte';
	import { closeAfter, menuItem } from './menu.ts';

	interface Props {
		episode: {
			id: number;
			status: string;
			positionSec: number | null;
			completed: boolean | null;
			durationSec: number | null;
			error: string | null;
			sourcePath: string;
			sourceSize: number;
			sourceRemoved: boolean;
			outputSize: number | null;
			convertSec: number | null;
			audioTracks: AudioTrack[];
			subtitles: SubtitleTrack[];
			/** Path to the video on the host, for mpv; only once converted. */
			playlist?: string | null;
		};
		/** Episodes before this one in the series not watched yet. */
		previousUnwatched: number;
		/** The user's lists, and whether this episode is in each one. */
		lists: { id: number; name: string; added: boolean }[];
		onrename: () => void;
	}

	let { episode, previousUnwatched, lists, onrename }: Props = $props();

	const ready = $derived(episode.status === 'ready');
	// The player ignores the first seconds too: it starts over below that.
	const resumeAt = $derived(
		!episode.completed && episode.positionSec && episode.positionSec > 5 ? episode.positionSec : 0
	);

	let info = $state<InfoDialog>();
	let regenerating = $state(false);

	const statusLabel = $derived(
		{
			ready: 'Convertido',
			processing: 'Convirtiendo',
			pending: 'En cola',
			error: 'Error al convertir',
			ignored: 'No se convertirá'
		}[episode.status] ?? episode.status
	);
</script>

{#snippet item(label: string)}
	<span class={menuItem}>{label}</span>
{/snippet}

<ActionMenu id="episode-menu-{episode.id}">
	{#snippet children(close)}
		{#if ready}
			{#if resumeAt}
				<a href="/watch/{episode.id}"
					>{@render item(`Continuar desde ${formatDuration(resumeAt)}`)}</a
				>
			{/if}
			<a href="/watch/{episode.id}?t=0">{@render item('Empezar desde el principio')}</a>
			<form method="post" action="?/setWatched" use:enhance={closeAfter(close)}>
				<input type="hidden" name="id" value={episode.id} />
				<input type="hidden" name="watched" value={String(!episode.completed)} />
				<button class="w-full">
					{@render item(episode.completed ? 'Marcar como no visto' : 'Marcar como visto')}
				</button>
			</form>
			{#if previousUnwatched}
				<form method="post" action="?/markPreviousWatched" use:enhance={closeAfter(close)}>
					<input type="hidden" name="id" value={episode.id} />
					<button class="w-full">
						{@render item(
							previousUnwatched === 1
								? 'Marcar el anterior como visto'
								: `Marcar los ${previousUnwatched} anteriores como vistos`
						)}
					</button>
				</form>
			{/if}

			<hr class="my-1 border-zinc-800" />
			<p class="px-3 pt-1 pb-0.5 text-xs text-zinc-500">Añadir a</p>
			{#each lists as list (list.id)}
				<!-- Stays open: it is common to add the same episode to several lists. -->
				<form method="post" action="?/toggleList" use:enhance>
					<input type="hidden" name="id" value={episode.id} />
					<input type="hidden" name="list" value={list.id} />
					<button
						class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left hover:bg-zinc-800"
						aria-pressed={list.added}
					>
						<span class="w-4 shrink-0 text-amber-400">{list.added ? '✓' : ''}</span>
						<span class="truncate">{list.name}</span>
					</button>
				</form>
			{:else}
				<a href="/lists">{@render item('Crear una lista…')}</a>
			{/each}
			<hr class="my-1 border-zinc-800" />
		{:else if episode.status === 'error' || episode.status === 'ignored'}
			<form method="post" action="?/retry" use:enhance={closeAfter(close)}>
				<input type="hidden" name="id" value={episode.id} />
				<button class="w-full">
					{@render item(
						episode.status === 'error' ? 'Reintentar la conversión' : 'Convertir de todos modos'
					)}
				</button>
			</form>
			{#if episode.status === 'error'}
				<form method="post" action="?/ignore" use:enhance={closeAfter(close)}>
					<input type="hidden" name="id" value={episode.id} />
					<button class="w-full">{@render item('Ignorar (no convertir)')}</button>
				</form>
			{/if}
			<hr class="my-1 border-zinc-800" />
		{/if}

		<button
			class="w-full"
			onclick={() => {
				close();
				onrename();
			}}
		>
			{@render item('Editar título')}
		</button>
		{#if episode.playlist}
			<CopyPathItem
				path={episode.playlist}
				label="Copiar ruta (para mpv u otro reproductor)"
				onclose={close}
			/>
		{/if}
		{#if ready}
			<form
				method="post"
				action="?/regenerateThumbnail"
				use:enhance={() => {
					regenerating = true;
					return async ({ update }) => {
						await update();
						regenerating = false;
						close();
					};
				}}
			>
				<input type="hidden" name="id" value={episode.id} />
				<button class="w-full" disabled={regenerating}>
					{@render item(regenerating ? 'Sacando miniatura…' : 'Otra miniatura')}
				</button>
			</form>
		{/if}
		<button
			class="w-full"
			onclick={() => {
				close();
				info?.open();
			}}
		>
			{@render item('Información')}
		</button>
	{/snippet}
</ActionMenu>

<InfoDialog bind:this={info} title="Información del capítulo">
	<dt>Estado</dt>
	<dd>
		{statusLabel}
		{#if episode.error}
			<span class="mt-1 block font-mono text-xs break-words text-red-400">{episode.error}</span>
		{/if}
	</dd>
	{#if episode.durationSec}
		<dt>Duración</dt>
		<dd>{formatDuration(episode.durationSec)}</dd>
	{/if}
	<dt>Original</dt>
	<dd>
		<span class="block font-mono text-xs break-all">{episode.sourcePath}</span>
		<span class="text-zinc-400">
			{formatBytes(episode.sourceSize)}{#if episode.sourceRemoved}
				· borrado tras convertirlo{/if}
		</span>
	</dd>
	{#if ready}
		<dt>Convertido</dt>
		<dd>
			{formatBytes(episode.outputSize)}{#if episode.convertSec}
				· tardó {formatDuration(episode.convertSec)}{/if}
		</dd>
		<dt>Audio</dt>
		<dd>{episode.audioTracks.map((t) => t.label).join(', ') || '—'}</dd>
		<dt>Subtítulos</dt>
		<dd>{episode.subtitles.map((t) => t.label).join(', ') || 'Ninguno'}</dd>
	{/if}
</InfoDialog>
