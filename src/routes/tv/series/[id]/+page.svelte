<script lang="ts">
	import TvEpisode from '#lib/components/TvEpisode.svelte';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import Backdrop from '#lib/components/Backdrop.svelte';
	import { backdropUrl } from '#lib/backdrop.svelte.ts';
	import { page } from '$app/state';
	import { formatDuration } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const info = $derived(data.info);
	const seasons = $derived([...new Set(data.episodes.map((e) => e.season))]);
	/** The one shown: where «Seguir» is, until another is chosen. */
	let chosen = $state<number | null>(null);
	const season = $derived(chosen ?? data.next?.season ?? seasons[0]);

	const years = $derived(
		info?.startYear
			? info.endYear && info.endYear !== info.startYear
				? `${info.startYear}–${info.endYear}`
				: info.endYear
					? `${info.startYear}`
					: `Desde ${info.startYear}`
			: null
	);
	const plural = (n: number | null, one: string, many: string) =>
		n ? `${n} ${n === 1 ? one : many}` : null;
	const facts = $derived(
		[
			years,
			plural(info?.seasons ?? null, 'temporada', 'temporadas'),
			plural(info?.episodes ?? null, 'capítulo', 'capítulos')
		].filter(Boolean)
	);
	const hasCard = $derived(Boolean(info && (facts.length || info.synopsis)));
</script>

<svelte:head>
	<title>{data.title} · JellyCartoon</title>
</svelte:head>

<Backdrop src={backdropUrl('serie', Number(page.params.id))} />

<TvHeader title={data.title} />

{#if form && 'message' in form}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{form.message}</p>
{/if}

<!-- «Seguir» small on the left, the card on the right; watched to the end, the card alone. -->
{#if data.next || hasCard}
	<div class="mb-12 grid grid-cols-3 gap-12">
		{#if data.next}
			<div>
				<p class="mb-3 text-3xl font-semibold text-amber-400">
					{data.started ? 'Seguir' : 'Empezar'}
				</p>
				<TvEpisode
					id={data.next.id}
					heading="T{data.next.season} E{data.next.number} · {data.next.title}"
					detail={formatDuration(data.next.durationSec)}
					positionSec={data.next.positionSec}
					durationSec={data.next.durationSec}
				/>
			</div>
		{/if}
		{#if hasCard && info}
			<div class={['min-w-0', data.next ? 'col-span-2' : 'col-span-3']}>
				{#if facts.length}
					<p class="text-2xl text-zinc-400">{facts.join(' · ')}</p>
				{/if}
				{#if info.originalTitle && info.originalTitle !== data.title}
					<p class="mt-1 text-xl text-zinc-500 italic">{info.originalTitle}</p>
				{/if}
				{#if info.synopsis}
					<p class="mt-5 line-clamp-6 leading-relaxed text-zinc-200">{info.synopsis}</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<div class="mb-6 flex flex-wrap items-center gap-x-8 gap-y-4">
	<h2 class="text-3xl font-semibold">Capítulos</h2>
	{#if seasons.length > 1}
		<!-- One season at a time: with a remote, a long list is many presses away. -->
		<div class="flex flex-wrap gap-3" role="group" aria-label="Temporada">
			{#each seasons as s (s)}
				<button
					class={[
						'rounded-full px-5 py-2 text-xl font-semibold transition duration-150 focus-visible:scale-110',
						s === season ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-200'
					]}
					aria-pressed={s === season}
					onclick={() => (chosen = s)}>T{s}</button
				>
			{/each}
		</div>
	{/if}
</div>

<div class="grid grid-cols-4 gap-8">
	{#each data.episodes.filter((e) => e.season === season) as ep (ep.id)}
		<TvEpisode
			id={ep.id}
			heading="E{ep.number} · {ep.title}"
			detail={formatDuration(ep.durationSec)}
			positionSec={ep.positionSec}
			durationSec={ep.durationSec}
			completed={ep.completed}
		/>
	{/each}
</div>
