<script lang="ts">
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import MusicBackground from '#lib/components/MusicBackground.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { coverUrl } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { SKIP_BACK, SKIP_FORWARD } from 'comun/podcasts.ts';

	/** What sounds on the TV, big, with its controls for the remote: a song or a podcast episode. */
	const current = $derived(music.radio ? undefined : music.current);
	const podcast = $derived(music.podcast);
	const upcoming = $derived(music.queue.slice(music.index + 1, music.index + 4));
	const progress = $derived(
		music.durationSec ? Math.min(1, music.positionSec / music.durationSec) : 0
	);

	// Stopped, or at the end of the queue: the remote needs something with the focus again. And
	// the other way, when the queue comes back from the server after the page was opened.
	let choose = $state<HTMLElement>();
	let toggle = $state<HTMLElement>();
	$effect(() => {
		if (!current && !podcast) choose?.focus();
		else if (document.activeElement === document.body) toggle?.focus();
	});

	const control =
		'flex items-center justify-center rounded-full transition duration-150 focus-visible:scale-110';
</script>

<svelte:head>
	<title>Sonando · JellyCartoon</title>
</svelte:head>

<MusicBackground snapcast={false} />

<TvHeader title="Sonando" />

{#if podcast}
	<div class="grid grid-cols-5 items-center gap-16">
		<div class="col-span-2">
			{#if podcast.imageUrl}
				<img
					src={podcast.imageUrl}
					alt=""
					class="aspect-square w-full rounded-2xl bg-zinc-800 object-cover shadow-2xl"
				/>
			{:else}
				<span
					class="flex aspect-square w-full items-center justify-center rounded-2xl bg-zinc-800 text-zinc-600"
					><SectionIcon name="podcasts" class="h-1/3 w-1/3" /></span
				>
			{/if}
		</div>

		<div class="col-span-3 min-w-0">
			<p class="line-clamp-2 text-5xl font-bold">{podcast.title}</p>
			<p class="mt-3 truncate text-4xl text-zinc-300">{podcast.podcastTitle}</p>
			{#if music.restored}
				<p class="mt-4 text-2xl text-amber-300">
					Sonaba en {music.restored.changedBy} · OK para seguir
				</p>
			{/if}

			<div class="mt-10 h-2 overflow-hidden rounded-full bg-white/15">
				<div class="h-full bg-amber-400" style:width="{progress * 100}%"></div>
			</div>
			<p class="mt-2 flex justify-between text-xl text-zinc-400 tabular-nums">
				<span>{formatDuration(music.positionSec) || '0:00'}</span>
				<span>{formatDuration(music.durationSec ?? podcast.durationSec)}</span>
			</p>

			<div class="mt-8 flex items-center gap-8">
				<button
					class={[control, 'h-20 w-20 bg-zinc-800/90 text-2xl font-semibold']}
					aria-label="Atrás {SKIP_BACK} segundos"
					onclick={() => music.skip(-SKIP_BACK)}>−{SKIP_BACK}</button
				>
				<!-- Where the remote starts: OK pauses and goes on. -->
				<button
					class={[control, 'h-28 w-28 bg-amber-500 text-zinc-950']}
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					data-focus
					bind:this={toggle}
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} class="h-12 w-12" /></button
				>
				<button
					class={[control, 'h-20 w-20 bg-zinc-800/90 text-2xl font-semibold']}
					aria-label="Adelante {SKIP_FORWARD} segundos"
					onclick={() => music.skip(SKIP_FORWARD)}>+{SKIP_FORWARD}</button
				>
				<button
					class={[control, 'ml-4 h-20 w-20 bg-zinc-800/90']}
					aria-label="Parar"
					onclick={() => music.stop()}><MediaIcon name="stop" class="h-9 w-9" /></button
				>
			</div>
		</div>
	</div>
{:else if current}
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
					><SectionIcon name="musica" class="h-1/3 w-1/3" /></span
				>
			{/if}
		</div>

		<div class="col-span-3 min-w-0">
			<p class="truncate text-6xl font-bold">{current.title}</p>
			<p class="mt-3 truncate text-4xl text-zinc-300">{current.artist}</p>
			<p class="mt-1 truncate text-3xl text-zinc-500">{current.album}</p>
			{#if music.restored}
				<p class="mt-4 text-2xl text-violet-300">
					Sonaba en {music.restored.changedBy} · OK para seguir
				</p>
			{/if}

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
					bind:this={toggle}
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
