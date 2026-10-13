<script lang="ts">
	import { formatDuration } from '#lib/format.ts';
	import { coverUrl } from '#lib/music.ts';
	import { musicTarget, watchSnapcast } from '#lib/music-target.svelte.ts';

	const snapcast = watchSnapcast();
	const state = $derived(snapcast.state);
	const track = $derived(state?.track);

	const control =
		'flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-zinc-800';
</script>

<!-- Only while something plays on Snapcast, whoever sent it. -->
{#if state?.active}
	<div class="rounded-t-md border border-zinc-700 bg-zinc-950/95 p-2 backdrop-blur">
		<input
			type="range"
			min="0"
			max={state.durationSec ?? track?.durationSec ?? 0}
			step="1"
			value={state.positionSec ?? 0}
			aria-label="Posición"
			class="mb-1 block h-1 w-full accent-amber-500"
			onchange={(e) => musicTarget.send({ action: 'seekTo', value: Number(e.currentTarget.value) })}
		/>
		<div class="flex items-center gap-3">
			<a
				href={track ? `/musica/${track.albumId}` : '/musica'}
				class="flex min-w-0 flex-1 items-center gap-3"
			>
				{#if track?.hasCover}
					<img
						src={coverUrl(track.albumId)}
						alt=""
						class="h-10 w-10 shrink-0 rounded bg-zinc-800 object-cover"
					/>
				{:else}
					<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-zinc-800"
						>♪</span
					>
				{/if}
				<span class="min-w-0">
					<span class="block truncate text-sm">
						<span class="text-amber-400">Snapcast:</span>
						{track?.title ?? '…'}
					</span>
					{#if track}
						<span class="block truncate text-xs text-zinc-400">{track.artist} · {track.album}</span>
					{/if}
				</span>
			</a>
			<span class="hidden font-mono text-xs text-zinc-400 tabular-nums sm:inline">
				{formatDuration(state.positionSec) || '0:00'} / {formatDuration(
					state.durationSec ?? track?.durationSec
				)}
			</span>
			<button
				class={control}
				aria-label="Anterior"
				onclick={() => musicTarget.send({ action: 'previous' })}>{'⏮︎'}</button
			>
			<button
				class="{control} bg-amber-500 text-zinc-950 hover:bg-amber-400"
				aria-label={state.paused ? 'Seguir' : 'Pausa'}
				onclick={() => musicTarget.send({ action: 'pause', value: !state.paused })}
				>{state.paused ? '▶︎' : '❚❚'}</button
			>
			<button
				class={control}
				aria-label="Siguiente"
				disabled={state.playlistPos !== null && state.playlistPos >= (state.playlistCount ?? 0)}
				onclick={() => musicTarget.send({ action: 'next' })}>{'⏭︎'}</button
			>
			<button
				class="{control} text-zinc-400 hover:text-white"
				aria-label="Parar"
				title="Parar Snapcast"
				onclick={() => musicTarget.send({ action: 'stop' })}>■</button
			>
		</div>
	</div>
{/if}
