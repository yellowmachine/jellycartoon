<script lang="ts">
	import type { MusicTrack } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { musicTarget } from '#lib/music-target.svelte.ts';

	/**
	 * «+ Añadir a la cola» of an album or a list: at the end of what plays. Said on the button for a
	 * moment, as the queue itself is out of sight (the bar's queue button opens it).
	 */
	let { tracks, toSnapcast }: { tracks: MusicTrack[]; toSnapcast: boolean } = $props();

	/** How long the button says what it did. */
	const SAID_MS = 2500;

	let said = $state<string | null>(null);
	let failed = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function add() {
		// Nothing on here: it starts it instead of queueing (music.append).
		const starts = !toSnapcast && !music.current;
		await musicTarget.append(tracks, toSnapcast);
		failed = toSnapcast && musicTarget.error !== null;
		const songs = tracks.length === 1 ? '1 canción' : `${tracks.length} canciones`;
		said = failed
			? 'No se pudo añadir'
			: starts
				? `▶︎ Sonando: ${songs}`
				: `✓ Añadidas a la cola: ${songs}`;
		clearTimeout(timer);
		timer = setTimeout(() => (said = null), SAID_MS);
	}

	$effect(() => () => clearTimeout(timer));
</script>

<button
	class={[
		'rounded-md border px-3 py-1.5 text-sm transition-colors duration-300',
		said === null
			? 'border-zinc-700 hover:bg-zinc-900'
			: failed
				? 'border-red-500/60 bg-red-500/10 text-red-300'
				: 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
	]}
	onclick={add}>{said ?? '+ Añadir a la cola'}</button
>
<!-- For screen readers: the button's new text is not announced by itself. -->
<span class="sr-only" aria-live="polite">{said ?? ''}</span>
