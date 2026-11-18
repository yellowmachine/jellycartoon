<script lang="ts">
	import MediaIcon from './MediaIcon.svelte';
	import SectionIcon from './SectionIcon.svelte';
	import LyricsView from './Lyrics.svelte';
	import { formatDuration } from '../format.ts';
	import { trackCover } from '../music.ts';
	import { music } from '../music-player.svelte.ts';
	import { musicBackground } from '../music-background-settings.svelte.ts';
	import { SKIP_BACK, SKIP_FORWARD } from '../podcasts.ts';
	import { loadLyrics } from '../lyrics-store.svelte.ts';
	import type { Lyrics } from '../lyrics.ts';

	/**
	 * What sounds, big, with its controls: a song or a podcast episode. /tv's from the sofa
	 * (`size="tv"`, for the remote), and the Vista's on the salon's tablet (#525, `size="tablet"`,
	 * in its 60 %, for a finger). Behind it, the page puts its MusicBackground. `toggle` and
	 * `choose` are there so /tv can give them the remote's focus.
	 */
	let {
		size,
		chooseHref,
		toggle = $bindable(),
		choose = $bindable()
	}: {
		size: 'tv' | 'tablet';
		/** Where «Elegir música» goes when nothing sounds. */
		chooseHref: string;
		toggle?: HTMLElement;
		choose?: HTMLElement;
	} = $props();

	const current = $derived(music.radio ? undefined : music.current);
	const podcast = $derived(music.podcast);
	const upcoming = $derived(music.queue.slice(music.index + 1, music.index + 4));

	/** Its lyrics, always when it has some (lyrics.ts), where «A continuación» was. */
	let lyrics = $state<Lyrics | null>(null);
	$effect(() => {
		const song = current && !current.clip && !current.src ? current.id : null;
		lyrics = null;
		if (song === null) return;
		let gone = false;
		void loadLyrics(song).then((found) => {
			if (!gone) lyrics = found;
		});
		return () => {
			gone = true;
		};
	});
	const progress = $derived(
		music.durationSec ? Math.min(1, music.positionSec / music.durationSec) : 0
	);

	/** With the «Portada» background (Ajustes) the cover is already behind: its column stays empty. */
	const coverBehind = $derived(musicBackground.style === 'cover');

	const tv = $derived(size === 'tv');
	/** The same screen, in each size: the TV's from 3 metres, the tablet's in its 60 %. */
	const s = $derived(
		tv
			? {
					grid: 'grid grid-cols-5 items-center gap-16',
					title: 'text-6xl',
					podcastTitle: 'line-clamp-2 text-5xl',
					second: 'mt-3 text-4xl',
					third: 'mt-1 text-3xl',
					note: 'mt-4 text-2xl',
					bar: 'mt-10',
					times: 'text-xl',
					controls: 'mt-8 gap-8',
					small: 'h-20 w-20 text-2xl',
					big: 'h-28 w-28',
					icon: 'h-9 w-9',
					bigIcon: 'h-12 w-12',
					lyrics: 'mt-10 h-[38vh] pb-[19vh]',
					after: 'text-2xl',
					afterTitle: 'mt-12 text-2xl'
				}
			: {
					grid: 'grid grid-cols-5 items-center gap-8',
					title: 'text-4xl',
					podcastTitle: 'line-clamp-2 text-3xl',
					second: 'mt-2 text-2xl',
					third: 'mt-1 text-xl',
					note: 'mt-3 text-lg',
					bar: 'mt-6',
					times: 'text-base',
					controls: 'mt-6 gap-5',
					small: 'h-16 w-16 text-xl',
					big: 'h-20 w-20',
					icon: 'h-7 w-7',
					bigIcon: 'h-10 w-10',
					lyrics: 'mt-6 h-[34vh] pb-[17vh]',
					after: 'text-lg',
					afterTitle: 'mt-8 text-lg'
				}
	);
	const control =
		'flex shrink-0 items-center justify-center rounded-full transition duration-150 focus-visible:scale-110 active:scale-95';
</script>

{#snippet cover(src: string | null, behind: boolean, icon: 'podcasts' | 'musica')}
	<div class="col-span-2">
		{#if src && behind}
			<!-- Behind, in the background. -->
		{:else if src}
			<img
				{src}
				alt=""
				class="aspect-square w-full rounded-2xl bg-zinc-800 object-cover shadow-2xl"
			/>
		{:else}
			<span
				class="flex aspect-square w-full items-center justify-center rounded-2xl bg-zinc-800 text-zinc-600"
				><SectionIcon name={icon} class="h-1/3 w-1/3" /></span
			>
		{/if}
	</div>
{/snippet}

{#snippet bar(colour: string, total: number | null | undefined)}
	<div class={[s.bar, 'h-2 overflow-hidden rounded-full bg-white/15']}>
		<div class={['h-full', colour]} style:width="{progress * 100}%"></div>
	</div>
	<p class={[s.times, 'mt-2 flex justify-between text-zinc-400 tabular-nums']}>
		<span>{formatDuration(music.positionSec) || '0:00'}</span>
		<span>{formatDuration(total)}</span>
	</p>
{/snippet}

{#if podcast}
	<div class={s.grid}>
		{@render cover(podcast.imageUrl ?? null, coverBehind, 'podcasts')}

		<div class="col-span-3 min-w-0">
			<p class={[s.podcastTitle, 'font-bold']}>{podcast.title}</p>
			<p class={[s.second, 'truncate text-zinc-300']}>{podcast.podcastTitle}</p>
			{#if music.restored}
				<p class={[s.note, 'text-amber-300']}>
					Sonaba en {music.restored.changedBy} · {tv ? 'OK' : 'toca ▶'} para seguir
				</p>
			{/if}

			{@render bar('bg-amber-400', music.durationSec ?? podcast.durationSec)}

			<div class={[s.controls, 'flex items-center']}>
				<button
					class={[control, s.small, 'bg-zinc-800/90 font-semibold']}
					aria-label="Atrás {SKIP_BACK} segundos"
					onclick={() => music.skip(-SKIP_BACK)}>−{SKIP_BACK}</button
				>
				<!-- Where the remote starts: OK pauses and goes on. -->
				<button
					class={[control, s.big, 'bg-amber-500 text-zinc-950']}
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					data-focus
					bind:this={toggle}
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} class={s.bigIcon} /></button
				>
				<button
					class={[control, s.small, 'bg-zinc-800/90 font-semibold']}
					aria-label="Adelante {SKIP_FORWARD} segundos"
					onclick={() => music.skip(SKIP_FORWARD)}>+{SKIP_FORWARD}</button
				>
				<button
					class={[control, s.small, 'ml-4 bg-zinc-800/90']}
					aria-label="Parar"
					onclick={() => music.stop()}><MediaIcon name="stop" class={s.icon} /></button
				>
			</div>
		</div>
	</div>
{:else if current}
	<div class={s.grid}>
		{@render cover(trackCover(current), coverBehind, 'musica')}

		<div class="col-span-3 min-w-0">
			<p class={[s.title, 'truncate font-bold']}>{current.title}</p>
			<p class={[s.second, 'truncate text-zinc-300']}>{current.artist}</p>
			<p class={[s.third, 'truncate text-zinc-500']}>{current.album}</p>
			{#if music.restored}
				<p class={[s.note, 'text-violet-300']}>
					Sonaba en {music.restored.changedBy} · {tv ? 'OK' : 'toca ▶'} para seguir
				</p>
			{/if}

			{@render bar('bg-violet-400', music.durationSec)}

			<div class={[s.controls, 'flex items-center']}>
				<button
					class={[control, s.small, 'bg-zinc-800/90']}
					aria-label="Anterior"
					onclick={() => music.previous()}><MediaIcon name="previous" class={s.icon} /></button
				>
				<!-- Where the remote starts: OK pauses and goes on. -->
				<button
					class={[control, s.big, 'bg-violet-500 text-zinc-950']}
					aria-label={music.playing ? 'Pausa' : 'Seguir'}
					data-focus
					bind:this={toggle}
					onclick={() => music.toggle()}
					><MediaIcon name={music.playing ? 'pause' : 'play'} class={s.bigIcon} /></button
				>
				<button
					class={[control, s.small, 'bg-zinc-800/90']}
					aria-label="Siguiente"
					onclick={() => music.next()}><MediaIcon name="next" class={s.icon} /></button
				>
				<button
					class={[control, s.small, 'ml-4 bg-zinc-800/90']}
					aria-label="Parar"
					onclick={() => music.stop()}><MediaIcon name="stop" class={s.icon} /></button
				>
			</div>

			{#if lyrics}
				<LyricsView
					{lyrics}
					positionSec={music.positionSec}
					big
					class="{s.lyrics} [mask-image:linear-gradient(transparent,black_15%,black_85%,transparent)]"
				/>
				{#if upcoming.length}
					<p class={[s.after, 'mt-4 truncate text-zinc-500']}>
						Después: {upcoming[0]!.title} · {upcoming[0]!.artist}
					</p>
				{/if}
			{:else if upcoming.length}
				<h2 class={[s.afterTitle, 'mb-3 font-semibold text-zinc-400']}>A continuación</h2>
				<ol class={[s.after, 'space-y-1']}>
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
	<p class={tv ? 'text-zinc-400' : 'text-xl text-zinc-400'}>No suena nada.</p>
	<p class={tv ? 'mt-8' : 'mt-6'}>
		<a
			bind:this={choose}
			href={chooseHref}
			class={[
				'inline-block rounded-full bg-violet-500 font-semibold text-zinc-950 transition duration-150 focus-visible:scale-110 active:scale-95',
				tv ? 'px-8 py-4 text-3xl' : 'px-6 py-3 text-xl'
			]}>Elegir música</a
		>
	</p>
{/if}
