<script lang="ts">
	import { enhance } from '$app/forms';
	import TvEpisode from '#lib/components/TvEpisode.svelte';
	import FridgeBoard from 'comun/components/FridgeBoard.svelte';
	import type { FridgeState } from 'comun/fridge.ts';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { avatar } from 'comun/avatars.ts';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import { coverUrl } from 'comun/music.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';
	import { tvShortcutWindow } from '#lib/tv-shortcut.svelte.ts';
	import { BIG_PICTURE } from '#lib/tv-shortcut-kinds.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// The fridge (#131), live: a post-it stuck from a phone appears here at once.
	let fridge = $derived<FridgeState>(data.fridge);
	$effect(() => {
		const events = new EventSource('/api/nevera/events');
		events.onmessage = (e) => (fridge = JSON.parse(e.data));
		return () => events.close();
	});
	const fridgeShown = $derived(
		fridge.notes.length > 0 ||
			fridge.list.items.some((i) => !i.done) ||
			fridge.today.events.length > 0
	);

	/** A shortcut's picture (#343): a frame, wide; a station's logo, on white; a game's box, whole. */
	function iconShape(kind: string) {
		if (kind === 'serie' || kind === 'pelicula') return 'w-40 object-cover';
		if (kind === 'radio') return 'w-24 bg-white object-contain p-1.5';
		if (kind === 'juego' || kind === 'steam') return 'w-24 object-contain';
		return 'w-24 object-cover';
	}
	const tileClass =
		'flex h-36 items-center gap-5 rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/30 via-sky-600/15 to-zinc-900 p-6 text-left shadow-lg transition duration-200 focus-visible:scale-105 focus-visible:border-white/30 focus-visible:shadow-2xl';

	type Shortcut = (typeof data.shortcuts)[number];

	/** The shortcut starting now, and how it went: Steam comes over this page once it opens. */
	let starting = $state<number | null>(null);
	let started = $state<{ text: string; failed: boolean } | null>(null);

	/**
	 * A tile with no page (#343): a site, in its window; a station, on the TV's speakers (OK on the
	 * one that is on stops it), as in /tv/radio; a Steam game or Big Picture, opened on the PC.
	 */
	async function start(s: Shortcut) {
		started = null;
		if (s.kind === 'url') return tvShortcutWindow.start(s);
		const target = s.target!;
		starting = s.id;
		if (s.kind === 'radio') {
			if (music.radio?.uuid === target) music.stop();
			else await musicTarget.playRadio(target, false);
		} else if (s.kind === 'steam') {
			started = { text: `Abriendo «${s.name}» en Steam…`, failed: false };
			const res = await fetch(
				`/api/juegos/steam/${target === BIG_PICTURE ? 'bigpicture' : target}`,
				{ method: 'POST' }
			).catch(() => null);
			if (!res?.ok) {
				const text = res ? (await res.json().catch(() => null))?.message : 'Sin conexión';
				started = { text: text ?? 'No se pudo abrir Steam', failed: true };
			}
		}
		starting = null;
	}

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
			href: '/tv/canales',
			icon: 'canales' as const,
			label: 'Canales',
			count: plural(data.counts.channels, 'canal', 'canales'),
			images: [],
			logos: false,
			text: 'text-orange-300',
			tone: 'from-orange-500/45 via-amber-600/25'
		},
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
		...(data.counts.podcasts !== null
			? [
					{
						href: '/tv/podcasts',
						icon: 'podcasts' as const,
						label: 'Podcasts',
						count: plural(data.counts.podcasts, 'podcast', 'podcasts'),
						images: data.mosaic.podcasts,
						logos: false,
						text: 'text-amber-300',
						tone: 'from-amber-500/45 via-yellow-600/25'
					}
				]
			: []),
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
			: []),
		...(data.counts.games !== null
			? [
					{
						href: '/tv/juegos',
						icon: 'juegos' as const,
						label: 'Juegos',
						count: plural(data.counts.games, 'juego', 'juegos'),
						images: [],
						logos: false,
						text: 'text-lime-300',
						tone: 'from-lime-500/45 via-green-600/25'
					}
				]
			: [])
	]);
</script>

<TvHeader />

{#if data.together.length}
	<p class="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-2xl text-zinc-300">
		Viendo:
		{#each data.together as kid (kid.id)}
			{@const a = avatar(kid.avatar)}
			<span class="flex items-center gap-2">
				<span class="flex h-10 w-10 items-center justify-center rounded-full text-2xl {a.color}"
					>{a.emoji}</span
				>
				<span class="font-semibold text-zinc-100">{kid.name}</span>
			</span>
		{/each}
	</p>
{/if}

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
			<SectionIcon name={s.icon} class="relative h-20 w-20 drop-shadow-lg" />
			<span class="relative">
				<span class="block text-5xl font-bold text-white drop-shadow-lg">{s.label}</span>
				<span class="mt-1 block text-xl text-zinc-200">{s.count}</span>
			</span>
		</a>
	{/each}
</nav>

{#if data.shortcuts.length}
	<!-- Sites of elsewhere (#327), each in a window of its own: the remote's power button goes from it
	     to here and back. And the TV view's own (#343), to their page. -->
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">Accesos directos</h2>
		{#if tvShortcutWindow.problem}
			<p class="mb-4 rounded-lg bg-red-950 p-4 text-red-200">{tvShortcutWindow.problem}</p>
		{/if}
		{#if musicTarget.error}
			<p class="mb-4 rounded-lg bg-red-950 p-4 text-red-200">{musicTarget.error}</p>
		{/if}
		{#if started}
			<p class={['mb-4 text-2xl', started.failed ? 'text-red-300' : 'text-sky-300']} role="status">
				{started.text}
			</p>
		{/if}
		{#if tvShortcutWindow.open}
			<div class="mb-4 flex items-center gap-6 rounded-2xl border border-white/10 bg-zinc-900 p-5">
				<p class="min-w-0 flex-1">
					{tvShortcutWindow.open.name} sigue abierto: el botón de encendido del mando va de uno a otro.
				</p>
				<button
					onclick={() => tvShortcutWindow.close()}
					class="shrink-0 rounded-xl bg-zinc-800 px-6 py-3 transition duration-200 focus-visible:scale-105 focus-visible:bg-zinc-700"
					>Cerrar {tvShortcutWindow.open.name}</button
				>
			</div>
		{/if}
		<div class="grid grid-cols-4 gap-8">
			{#each data.shortcuts as s (s.id)}
				{#snippet tile()}
					<!-- A site's own icon, from its page (site-icon.ts), if it let us have it; the cover, the
					     logo or the box of the rest. -->
					{#if s.icon}
						<img
							src={s.icon}
							alt=""
							class={['h-24 shrink-0 rounded-2xl shadow-md', iconShape(s.kind)]}
						/>
					{/if}
					<span class="min-w-0">
						<span class="block truncate text-3xl font-bold text-white">{s.name}</span>
						<span class="block truncate text-lg text-zinc-300"
							>{starting === s.id
								? s.kind === 'canal'
									? 'Sintonizando…'
									: 'Un momento…'
								: s.kind === 'radio' && music.radio?.uuid === s.target
									? 'Sonando'
									: s.detail}</span
						>
					</span>
				{/snippet}
				{#if s.href}
					<!-- Its page, where the episode, the version or the saved game is chosen (#343). -->
					<a href={s.href} class={tileClass}>{@render tile()}</a>
				{:else if s.kind === 'canal'}
					<!-- Live on the living room's mpv, as from /tv/canales; a child, within its time. -->
					<form
						method="post"
						action="?/channel"
						use:enhance={() => {
							music.stop();
							started = null;
							starting = s.id;
							return async ({ update }) => {
								await update();
								starting = null;
							};
						}}
					>
						<input type="hidden" name="id" value={s.target} />
						<button class={[tileClass, 'w-full']} disabled={starting !== null}
							>{@render tile()}</button
						>
					</form>
				{:else}
					<button
						onclick={() => start(s)}
						disabled={starting !== null}
						class={[
							tileClass,
							s.kind === 'radio' && music.radio?.uuid === s.target && 'border-emerald-400!'
						]}>{@render tile()}</button
					>
				{/if}
			{/each}
		</div>
	</section>
{/if}

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

{#if fridgeShown}
	<!-- Only to look at: they are written from the phone (/nevera) or by voice. -->
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">La nevera</h2>
		<FridgeBoard {fridge} readonly big />
	</section>
{/if}

<!-- At the end, so the remote starts on what to watch: the whole app, for the rest; and another
     child, for one who entered with permission (#141). -->
<div class="mt-16 flex justify-center gap-6">
	{#if data.switchKid}
		<!-- Out of its session: /login sends the device back to «¿Quién eres?». -->
		<form method="post" action="/logout">
			<button class="rounded-lg px-4 py-2 text-xl text-zinc-500 hover:text-zinc-300"
				>Cambiar de peque</button
			>
		</form>
	{/if}
	<a href="/" class="rounded-lg px-4 py-2 text-xl text-zinc-500 hover:text-zinc-300"
		>Ir a la app completa</a
	>
</div>
