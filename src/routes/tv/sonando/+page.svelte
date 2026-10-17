<script lang="ts">
	import MediaIcon from '#lib/components/MediaIcon.svelte';
	import MusicBackground from '#lib/components/MusicBackground.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import TvIcon from '#lib/components/TvIcon.svelte';
	import { formatDuration } from '#lib/format.ts';
	import { coverUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';

	/** What sounds on the TV, big, with its controls for the remote. */
	const current = $derived(music.radio ? undefined : music.current);
	const upcoming = $derived(music.queue.slice(music.index + 1, music.index + 4));
	const progress = $derived(
		music.durationSec ? Math.min(1, music.positionSec / music.durationSec) : 0
	);

	// Stopped, or at the end of the queue: the remote needs something with the focus again.
	let choose = $state<HTMLElement>();
	$effect(() => {
		if (!current) choose?.focus();
	});

	const control =
		'flex items-center justify-center rounded-full transition duration-150 focus-visible:scale-110';
</script>

<svelte:head>
	<title>Sonando · JellyCartoon</title>
</svelte:head>

<MusicBackground snapcast={false} />

<TvHeader title="Sonando" />

{#if current}
	<div class="grid grid-cols-5 items-center gap-16">
		<div class="col-span-2">
			{#if current.hasCover}
				<img
					src={coverUrl(current.albumId)}
					alt=""
					class="aspect-square w-full rounded-2xl object-cover shadow-2xl"
				/>
			{:else}
				<span
					class="flex aspect-square w-full items-center justify-center rounded-2xl bg-zinc-800 text-zinc-600"
					><TvIcon name="musica" class="h-1/3 w-1/3" /></span
				>
			{/if}
		</div>

		<div class="col-span-3 min-w-0">
			<p class="truncate text-6xl font-bold">{current.title}</p>
			<p class="mt-3 truncate text-4xl text-zinc-300">{current.artist}</p>
			<p class="mt-1 truncate text-3xl text-zinc-500">{current.album}</p>

			<div class="mt-10 h-2 overflow-hidden rounded-full bg-white/15">
				<div class="h-full bg-violet-400" style:width="{progress * 100}%"></div>
			</div>
			<p class="mt-2 flex justify-between text-xl text-zinc-400 tabular-nums">
				<span>{formatDuration(music.positionSec) || '0:00'}</span>
				<span>{formatDuration(music.durationSec)}</span>
			</p>

			<div class="mt-8 flex items-center gap-8">
				<button
					class={[control, 'h-20 w-20 bg-zinc-800/90']}
					aria-label="Anterior"
					onclick={() => music.previous()}><MediaIcon name="previous" class="h-9 w-9" /></button
				>
				<!-- Where the remote starts: OK pauses and goes on. -->
				<button
					class={[control, 'h-28 w-28 bg-violet-500 text-zinc-950']}
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					data-focus
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} class="h-12 w-12" /></button
				>
				<button
					class={[control, 'h-20 w-20 bg-zinc-800/90']}
					aria-label="Siguiente"
					onclick={() => music.next()}><MediaIcon name="next" class="h-9 w-9" /></button
				>
				<button
					class={[control, 'ml-4 h-20 w-20 bg-zinc-800/90']}
					aria-label="Parar"
					onclick={() => music.stop()}><MediaIcon name="stop" class="h-9 w-9" /></button
				>
			</div>

			{#if upcoming.length}
				<h2 class="mt-12 mb-3 text-2xl font-semibold text-zinc-400">A continuación</h2>
				<ol class="space-y-1 text-2xl">
					{#each upcoming as t, i (`${i}:${t.id}`)}
						<li class="truncate">
							{t.title} <span class="text-zinc-500">· {t.artist}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</div>
	</div>
{:else}
	<p class="text-zinc-400">No suena nada.</p>
	<p class="mt-8">
		<a
			bind:this={choose}
			href="/tv/musica"
			class="inline-block rounded-full bg-violet-500 px-8 py-4 text-3xl font-semibold text-zinc-950 transition duration-150 focus-visible:scale-110"
			>Elegir música</a
		>
	</p>
{/if}
