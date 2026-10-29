<script lang="ts">
	import { snapshot } from '$app/navigation';
	import Backdrop from 'comun/components/Backdrop.svelte';
	import { formatDuration } from 'comun/format.ts';
	import { languageLabel, normalizeLang } from 'comun/languages.ts';
	import { thumbUrl } from 'comun/thumb.svelte.ts';
	import { seriesBackdropUrl } from '#lib/music-pass.svelte.ts';
	import EpisodeMenu from './EpisodeMenu.svelte';
	import type { PageProps } from './$types';

	/**
	 * A series (#253), as jellycartoon's page for watching: by season and by audio, in a list or a
	 * grid, each episode with how far it was watched. What manages it (titles, subtitles, labels,
	 * 720p, seasons, deleting) is at home.
	 */
	let { data, form }: PageProps = $props();

	/** Season 0 is the extras, after the last one (#220). */
	const seasonName = (season: number) => (season === 0 ? 'Extras' : `Temporada ${season}`);

	/** A list or a grid, on this device; drawn only in the browser ((video)/+layout.ts). */
	const VIEW_KEY = 'nube:episode-view';
	function storedView(): 'list' | 'grid' {
		try {
			return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
		} catch {
			return 'list';
		}
	}
	let view = $state(storedView());
	const grid = $derived(view === 'grid');
	function saveView(value: 'list' | 'grid') {
		view = value;
		try {
			localStorage.setItem(VIEW_KEY, value);
		} catch {
			// Private window: it is only forgotten.
		}
	}

	/** The only season shown, or all. */
	let season = $state<number | null>(null);
	/** Only the episodes with an audio track in this language, or all. */
	let audio = $state<string | null>(null);
	// Kept when coming back to the page (e.g. from an episode), and back to all when entering a
	// series anew: https://svelte.dev/docs/kit/$app-navigation#snapshot
	snapshot({
		capture: () => ({ season, audio }),
		restore: (value) => ({ season, audio } = value),
		reset: () => {
			season = null;
			audio = null;
		}
	});
	const audioLangs = (ep: { audioTracks: { lang: string }[] }) =>
		new Set(ep.audioTracks.map((t) => normalizeLang(t.lang)));
	/** The audio languages worth filtering by: those that some episodes have and others do not. */
	let audioOptions = $derived.by(() => {
		const episodes = data.seasons.flatMap((s) => s.episodes);
		const counts = new Map<string, number>();
		for (const ep of episodes)
			for (const lang of audioLangs(ep)) counts.set(lang, (counts.get(lang) ?? 0) + 1);
		const langs = [...counts.keys()].sort((a, b) =>
			languageLabel(a).localeCompare(languageLabel(b))
		);
		return langs.some((lang) => counts.get(lang)! < episodes.length) ? langs : [];
	});
	let visibleSeasons = $derived.by(() => {
		const seasons = data.seasons.some((s) => s.season === season)
			? data.seasons.filter((s) => s.season === season)
			: data.seasons;
		const lang = audio && audioOptions.includes(audio) ? audio : null;
		if (!lang) return seasons;
		return seasons
			.map(({ season, episodes }) => ({
				season,
				episodes: episodes.filter((ep) => audioLangs(ep).has(lang))
			}))
			.filter(({ episodes }) => episodes.length > 0);
	});
</script>

<svelte:head>
	<title>{data.series.title} · Seilide</title>
</svelte:head>

<Backdrop src={seriesBackdropUrl(data.series.id)} />

<div class="mb-6 flex flex-wrap items-end justify-between gap-4">
	<h1 class="text-2xl font-bold [text-shadow:0_1px_10px_rgb(0_0_0/0.9)]">{data.series.title}</h1>
</div>
{#if form?.message}
	<p class="-mt-4 mb-4 text-sm text-red-400">{form.message}</p>
{/if}

<div class="mb-2 flex flex-wrap items-center justify-end gap-2">
	{#if data.seasons.length > 1}
		<select
			aria-label="Temporada"
			bind:value={season}
			class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
		>
			<option value={null}>Todas las temporadas</option>
			{#each data.seasons as { season: number } (number)}
				<option value={number}>{seasonName(number)}</option>
			{/each}
		</select>
	{/if}
	{#if audioOptions.length}
		<select
			aria-label="Idioma de audio"
			bind:value={audio}
			class="rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm"
		>
			<option value={null}>Todos los audios</option>
			{#each audioOptions as lang (lang)}
				<option value={lang}>Audio: {languageLabel(lang)}</option>
			{/each}
		</select>
	{/if}
	<div class="flex rounded-md border border-zinc-700 p-0.5" role="group" aria-label="Vista">
		{#each [{ value: 'list', label: 'Ver en lista' }, { value: 'grid', label: 'Ver en cuadrícula' }] as const as { value, label } (value)}
			<button
				class={[
					'rounded px-1.5 py-1',
					view === value ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-white'
				]}
				title={label}
				aria-label={label}
				aria-pressed={view === value}
				onclick={() => saveView(value)}
			>
				<svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor" aria-hidden="true">
					{#if value === 'list'}
						<rect x="4" y="5" width="16" height="3" rx="1" />
						<rect x="4" y="10.5" width="16" height="3" rx="1" />
						<rect x="4" y="16" width="16" height="3" rx="1" />
					{:else}
						<rect x="4" y="4" width="7" height="7" rx="1" />
						<rect x="13" y="4" width="7" height="7" rx="1" />
						<rect x="4" y="13" width="7" height="7" rx="1" />
						<rect x="13" y="13" width="7" height="7" rx="1" />
					{/if}
				</svg>
			</button>
		{/each}
	</div>
</div>

{#each visibleSeasons as { season, episodes } (season)}
	<h2 class="mt-6 mb-3 font-semibold text-zinc-300">{seasonName(season)}</h2>
	<ul
		class={grid
			? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4'
			: 'divide-y divide-zinc-800 rounded-md border border-zinc-800'}
	>
		{#each episodes as ep (ep.id)}
			<li
				class={grid
					? 'flex flex-col overflow-hidden rounded-md border border-zinc-800'
					: 'flex items-center pr-3'}
			>
				<a
					href="/watch/{ep.id}"
					class={[
						'relative flex min-w-0 flex-1 hover:bg-zinc-900',
						grid ? 'flex-col gap-2 p-2' : 'items-center gap-4 p-3'
					]}
				>
					<div
						class={[
							'relative aspect-video shrink-0 overflow-hidden rounded bg-zinc-800',
							grid ? 'w-full' : 'w-32'
						]}
					>
						<img src={thumbUrl(ep.id)} alt="" class="h-full w-full object-cover" loading="lazy" />
						{#if ep.completed}
							<span
								class="absolute top-1 left-1 rounded bg-zinc-950/80 px-1.5 py-0.5 text-xs font-medium text-amber-400"
								>✓ Visto</span
							>
						{/if}
						<!-- A watched episode has its position reset to 0 (next time starts over): full bar. -->
						{#if (ep.completed || ep.positionSec) && ep.durationSec}
							<div class="absolute inset-x-0 bottom-0 h-1 bg-zinc-700">
								<div
									class="h-full bg-amber-400"
									style:width="{ep.completed ? 100 : (ep.positionSec / ep.durationSec) * 100}%"
								></div>
							</div>
						{/if}
					</div>
					<div class="min-w-0 flex-1">
						<p class={grid ? 'line-clamp-2 text-sm' : 'truncate'}>{ep.number}. {ep.title}</p>
						<p class="text-xs text-zinc-400">
							{formatDuration(ep.durationSec)}{#if ep.completed}
								· visto{/if}
						</p>
					</div>
				</a>
				<!-- In the grid, the menu goes under the card. -->
				<div class={grid ? 'mt-auto flex items-center justify-end gap-2 px-2 pb-2' : 'contents'}>
					<EpisodeMenu episode={ep} />
				</div>
			</li>
		{/each}
	</ul>
{/each}
