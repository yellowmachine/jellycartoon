<script lang="ts">
	import { enhance } from '$app/forms';
	import TvEpisode from '#lib/components/TvEpisode.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import TvIcon from '#lib/components/TvIcon.svelte';
	import { coverUrl } from '#lib/music.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { thumbUrl } from '#lib/thumb.svelte.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const sections = $derived([
		{
			href: '/tv/series',
			icon: 'series' as const,
			label: 'Series',
			count: plural(data.counts.series, 'serie', 'series'),
			images: data.mosaic.series.map(thumbUrl),
			logos: false,
			text: 'text-sky-300',
			tone: 'from-sky-500/45 via-indigo-600/25'
		},
		...(data.counts.films !== null
			? [
					{
						href: '/tv/cine',
						icon: 'cine' as const,
						label: 'Cine',
						count: plural(data.counts.films, 'película', 'películas'),
						images: data.mosaic.films.map((id) => `/api/movie-thumb/${id}`),
						logos: false,
						text: 'text-rose-300',
						tone: 'from-rose-500/45 via-orange-600/25'
					}
				]
			: []),
		{
			href: '/tv/radio',
			icon: 'radio' as const,
			label: 'Radio',
			count: plural(data.counts.stations, 'emisora', 'emisoras'),
			images: data.mosaic.stations,
			logos: true,
			text: 'text-emerald-300',
			tone: 'from-emerald-500/45 via-teal-600/25'
		},
		...(data.counts.albums !== null
			? [
					{
						href: '/tv/musica',
						icon: 'musica' as const,
						label: 'Música',
						count: plural(data.counts.albums, 'álbum', 'álbumes'),
						images: data.mosaic.albums.map(coverUrl),
						logos: false,
						text: 'text-violet-300',
						tone: 'from-violet-500/45 via-fuchsia-600/25'
					}
				]
			: [])
	]);
</script>

<TvHeader />

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

<!-- As many columns as sections: without films or music, fewer and wider ones, and no gap. -->
<nav
	class="mb-14 grid gap-8"
	style:grid-template-columns="repeat({sections.length}, minmax(0, 1fr))"
>
	{#each sections as s (s.href)}
		<a
			href={s.href}
			class={[
				'group relative flex h-64 flex-col justify-between overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 p-8 shadow-lg transition duration-200 focus-visible:scale-105 focus-visible:border-white/30 focus-visible:shadow-2xl',
				s.text
			]}
		>
			<!-- What is inside, as a mosaic: dim, so the name reads over it; brighter with the focus. -->
			{#if s.images.length}
				<span
					class="absolute inset-0 grid grid-cols-3 grid-rows-2 gap-0.5 opacity-35 transition-opacity duration-200 group-focus-visible:opacity-60"
					aria-hidden="true"
				>
					{#each s.images as src (src)}
						{#if s.logos}
							<span class="flex items-center justify-center bg-white/90 p-4"
								><img {src} alt="" class="max-h-full max-w-full object-contain" /></span
							>
						{:else}
							<img {src} alt="" class="h-full w-full object-cover" />
						{/if}
					{/each}
				</span>
			{/if}
			<!-- The section's colour over it, and dark at the bottom, under the name. -->
			<span class={['absolute inset-0 bg-gradient-to-br to-transparent', s.tone]} aria-hidden="true"
			></span>
			<span
				class="absolute inset-0 bg-gradient-to-t from-zinc-950/95 via-zinc-950/40 to-zinc-950/10"
				aria-hidden="true"
			></span>
			<TvIcon name={s.icon} class="relative h-20 w-20 drop-shadow-lg" />
			<span class="relative">
				<span class="block text-5xl font-bold text-white drop-shadow-lg">{s.label}</span>
				<span class="mt-1 block text-xl text-zinc-200">{s.count}</span>
			</span>
		</a>
	{/each}
</nav>

{#if data.today}
	<form
		method="post"
		action="?/today"
		use:enhance={() => {
			music.stop();
		}}
		class="mb-12"
	>
		<button
			class="flex w-full items-center gap-6 rounded-2xl border border-amber-500/40 bg-gradient-to-r from-amber-500/20 to-transparent p-5 text-left transition duration-200 focus-visible:scale-[1.02]"
		>
			<img
				src={thumbUrl(data.today.next.id)}
				alt=""
				class="aspect-video w-64 shrink-0 rounded-lg object-cover"
			/>
			<span class="min-w-0">
				<span class="block text-3xl font-semibold text-amber-400">Programación de hoy</span>
				<span class="block truncate">{data.today.next.seriesTitle} · {data.today.next.title}</span>
				<span class="block text-xl text-zinc-400">Quedan {data.today.pending}</span>
			</span>
		</button>
	</form>
{/if}

{#if data.continueWatching.length}
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">Seguir viendo</h2>
		<div class="grid grid-cols-4 gap-8">
			{#each data.continueWatching as ep (ep.id)}
				<TvEpisode
					id={ep.id}
					heading={ep.seriesTitle}
					detail="T{ep.season} E{ep.number} · {ep.title}"
					positionSec={ep.positionSec}
					durationSec={ep.durationSec}
				/>
			{/each}
		</div>
	</section>
{/if}

<!-- At the end, so the remote starts on what to watch: the whole app, for the rest. -->
<p class="mt-16 text-center">
	<a href="/" class="rounded-lg px-4 py-2 text-xl text-zinc-500 hover:text-zinc-300"
		>Ir a la app completa</a
	>
</p>
