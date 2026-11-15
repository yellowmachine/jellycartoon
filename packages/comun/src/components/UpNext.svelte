<script lang="ts">
	import { formatDuration } from 'comun/format.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';

	/**
	 * «Siguiente en 8 s» over the video when an episode ends, at home and in Seilide. Compact, the
	 * thumbnail beside its title: it is drawn inside the video, which out of full screen is only as
	 * tall as 16:9 of its width (a tablet), and a full card left the buttons below, cut off.
	 */

	let {
		episode,
		countdown,
		onplay,
		oncancel
	}: {
		episode: {
			id: number;
			season: number;
			number: number;
			title: string;
			durationSec: number | null;
		};
		countdown: number | null;
		onplay: () => void;
		oncancel: () => void;
	} = $props();
</script>

<div class="w-full max-w-sm text-center">
	<p class="mb-2 text-lg font-semibold">Siguiente en {countdown} s</p>
	<a
		href="/watch/{episode.id}"
		onclick={(e) => {
			e.preventDefault();
			onplay();
		}}
		class="flex items-center gap-3 rounded-md p-1 text-left hover:bg-zinc-900"
	>
		<img
			src={thumbUrl(episode.id)}
			alt=""
			class="aspect-video w-28 shrink-0 rounded bg-zinc-800 object-cover sm:w-36"
		/>
		<span class="min-w-0">
			<span class="line-clamp-2 text-sm">{episode.title}</span>
			<span class="block truncate text-xs text-zinc-400">
				T{episode.season} E{episode.number}{episode.durationSec
					? ` · ${formatDuration(episode.durationSec)}`
					: ''}
			</span>
		</span>
	</a>
	<div class="mt-3 flex justify-center gap-3">
		<button
			class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
			onclick={onplay}>Ver ahora</button
		>
		<button class="rounded-md border border-zinc-600 px-4 py-2 hover:bg-zinc-800" onclick={oncancel}
			>Cancelar</button
		>
	</div>
</div>
