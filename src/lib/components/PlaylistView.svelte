<script lang="ts" module>
	import type { AudioTrack, SubtitleTrack } from '#lib/languages.ts';

	export interface PlaylistEntry {
		id: number;
		title: string;
		season: number;
		number: number;
		durationSec: number | null;
		audioTracks: AudioTrack[];
		subtitles: SubtitleTrack[];
		seriesTitle: string;
		positionSec: number | null;
		watched: boolean;
		/** Watched at some point outside this playlist; it still plays. */
		completedBefore?: boolean | null;
	}
</script>

<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Player from '#lib/components/Player.svelte';
	import { playerSize } from '#lib/player-size.svelte.ts';
	import { formatDuration } from '#lib/format.ts';
	import { thumbUrl } from '#lib/thumb.svelte.ts';

	interface Props {
		items: PlaylistEntry[];
		settings: ComponentProps<typeof Player>['settings'];
		/** Shown when every episode has been watched. */
		finished: Snippet;
		/** Extra buttons next to each item. */
		itemActions?: Snippet<[PlaylistEntry, number]>;
		/** Below the list. */
		footer?: Snippet;
		/** Whether it can be played on the host's screen (the page has a `salon` action). */
		salon?: boolean;
	}

	let { items, settings, finished, itemActions, footer, salon = false }: Props = $props();

	/** Why the living room could not start it, e.g. mpv is not running. */
	let salonError = $state<string | null>(null);
	const sendToSalon: SubmitFunction =
		() =>
		async ({ result }) => {
			salonError = result.type === 'failure' ? String(result.data?.message ?? 'Error') : null;
		};

	// Starts at the first episode not watched yet; clicking another one plays it instead.
	let current = $derived(items.findIndex((i) => !i.watched));
	let item = $derived(items[current]);
	/** Off when the last one ended with «Parar»: the next one is shown, waiting. */
	let autoplay = $state(true);

	function ended(autoNext: boolean) {
		autoplay = autoNext;
		invalidateAll();
	}
</script>

<!-- In "cinema" the video takes the full width and the list goes below it. -->
<div class={['grid gap-6', playerSize.value !== 'cinema' && 'lg:grid-cols-[1fr_20rem]']}>
	<div>
		{#if item}
			<Player
				episodeId={item.id}
				startAt={item.watched ? 0 : item.positionSec}
				audioTracks={item.audioTracks}
				subtitles={item.subtitles}
				{settings}
				{autoplay}
				onended={ended}
			/>
			<p class="mt-3 text-sm text-zinc-400">{item.seriesTitle}</p>
			<h2 class="text-lg font-semibold">
				T{item.season} E{item.number} · {item.title}
			</h2>
		{:else}
			<div
				class="flex aspect-video flex-col items-center justify-center gap-4 rounded-md bg-zinc-900"
			>
				{@render finished()}
			</div>
		{/if}
	</div>

	<aside>
		{#if salon && items.some((i) => !i.watched)}
			<form method="post" action="?/salon" use:enhance={sendToSalon} class="mb-3">
				<button
					class="w-full rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400"
				>
					▶︎ Ver lo que queda en el salón
				</button>
			</form>
		{/if}
		{#if salonError}
			<p class="mb-3 text-sm text-red-400">{salonError}</p>
		{/if}
		<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each items as it, index (it.id)}
				<li class={['flex items-center', index === current && 'bg-zinc-900']}>
					<button
						class={[
							'flex min-w-0 flex-1 items-center gap-3 p-2 text-left hover:bg-zinc-900',
							it.watched && index !== current && 'opacity-50'
						]}
						onclick={() => {
							current = index;
							autoplay = true;
						}}
					>
						<img
							src={thumbUrl(it.id)}
							alt=""
							class="aspect-video w-20 shrink-0 rounded bg-zinc-800 object-cover"
						/>
						<span class="min-w-0 flex-1">
							<span class="flex gap-1 text-sm">
								<span class="truncate">{it.seriesTitle}</span>
								{#if it.completedBefore && !it.watched}
									<span class="shrink-0 text-xs leading-5 text-amber-400/80">· visto antes</span>
								{/if}
							</span>
							<span class="block truncate text-xs text-zinc-400">
								{it.watched ? '✓ ' : ''}T{it.season} E{it.number} · {it.title}
							</span>
						</span>
						<span class="text-xs text-zinc-500">{formatDuration(it.durationSec)}</span>
					</button>
					{#if salon}
						<form method="post" action="?/salon" use:enhance={sendToSalon} class="shrink-0">
							<input type="hidden" name="episodeId" value={it.id} />
							<button
								class="px-2 py-3 text-xs text-zinc-500 hover:text-amber-400"
								title="Ver desde aquí en el salón"
								aria-label="Ver desde aquí en el salón">▶︎</button
							>
						</form>
					{/if}
					{@render itemActions?.(it, index)}
				</li>
			{/each}
		</ol>
		{@render footer?.()}
	</aside>
</div>
