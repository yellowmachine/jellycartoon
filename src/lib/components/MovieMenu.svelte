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
		};
		onrename: () => void;
	}

	let { movie, onrename }: Props = $props();

	let info = $state<InfoDialog>();
</script>

<ActionMenu id="movie-menu-{movie.id}">
	{#snippet children(close)}
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
