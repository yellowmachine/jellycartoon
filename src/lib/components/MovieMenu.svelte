<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatBytes, formatDuration } from '#lib/format.ts';
	import type { AudioTrack } from '#lib/languages.ts';
	import ActionMenu from './ActionMenu.svelte';
	import CopyPathItem from './CopyPathItem.svelte';
	import InfoDialog from './InfoDialog.svelte';
	import { closeAfter, menuItem } from './menu.ts';

	interface Props {
		movie: {
			id: number;
			path: string;
			size: number;
			status: string;
			error: string | null;
			durationSec: number | null;
			video: string | null;
			audioTracks: AudioTrack[];
			subtitles: AudioTrack[];
			/** Where the file is on the host, for mpv. */
			hostPath: string | null;
			positionSec: number | null;
			completed: boolean | null;
		};
		/** Whether it can be played on the host's screen. */
		mpv: boolean;
		onrename: () => void;
	}

	let { movie, mpv, onrename }: Props = $props();

	const ready = $derived(movie.status === 'ready');
	// mpv starts over below that too.
	const resumeAt = $derived(
		!movie.completed && movie.positionSec && movie.positionSec > 5 ? movie.positionSec : 0
	);

	let info = $state<InfoDialog>();
</script>

<ActionMenu id="movie-menu-{movie.id}">
	{#snippet children(close)}
		{#if ready && mpv}
			{#if resumeAt}
				<form method="post" action="?/play" use:enhance={closeAfter(close)}>
					<input type="hidden" name="id" value={movie.id} />
					<button class={menuItem}>
						▶︎ Continuar en el salón desde {formatDuration(resumeAt)}
					</button>
				</form>
			{/if}
			<form method="post" action="?/play" use:enhance={closeAfter(close)}>
				<input type="hidden" name="id" value={movie.id} />
				<input type="hidden" name="from" value="start" />
				<button class={menuItem}>
					{resumeAt ? 'Empezar desde el principio' : '▶︎ Ver en el salón'}
				</button>
			</form>
		{/if}
		{#if ready}
			<form method="post" action="?/setWatched" use:enhance={closeAfter(close)}>
				<input type="hidden" name="id" value={movie.id} />
				<input type="hidden" name="watched" value={String(!movie.completed)} />
				<button class={menuItem}>
					{movie.completed ? 'Marcar como no vista' : 'Marcar como vista'}
				</button>
			</form>
			<hr class="my-1 border-zinc-800" />
		{/if}
		{#if movie.status === 'error'}
			<form method="post" action="?/retry" use:enhance={closeAfter(close)}>
				<input type="hidden" name="id" value={movie.id} />
				<button class={menuItem}>Volver a catalogar</button>
			</form>
			<hr class="my-1 border-zinc-800" />
		{/if}
		<button
			class={menuItem}
			onclick={() => {
				close();
				onrename();
			}}>Editar título</button
		>
		{#if movie.hostPath}
			<CopyPathItem path={movie.hostPath} label="Copiar ruta (para mpv)" onclose={close} />
		{/if}
		<button
			class={menuItem}
			onclick={() => {
				close();
				info?.open();
			}}>Información</button
		>
	{/snippet}
</ActionMenu>

<InfoDialog bind:this={info} title="Información de la película">
	<dt>Fichero</dt>
	<dd>
		<span class="block font-mono text-xs break-all">{movie.path}</span>
		<span class="text-zinc-400">{formatBytes(movie.size)}</span>
	</dd>
	{#if movie.error}
		<dt>Error</dt>
		<dd class="font-mono text-xs break-words text-red-400">{movie.error}</dd>
	{/if}
	{#if movie.status === 'ready'}
		<dt>Duración</dt>
		<dd>{formatDuration(movie.durationSec) || '—'}</dd>
		<dt>Vídeo</dt>
		<dd>{movie.video ?? '—'}</dd>
		<dt>Audio</dt>
		<dd>{movie.audioTracks.map((t) => t.label).join(', ') || '—'}</dd>
		<dt>Subtítulos</dt>
		<dd>{movie.subtitles.map((t) => t.label).join(', ') || 'Ninguno'}</dd>
	{/if}
</InfoDialog>
