<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import TvHeader from '#lib/components/TvHeader.svelte';
	import { music } from 'comun/music-player.svelte.ts';
	import { musicTarget } from 'comun/music-target.svelte.ts';
	import { COUNTRIES, LANGUAGES, STATIONS, type RadioStation } from 'comun/radio.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	// Spanish first: it is the house's own.
	const languages = [...LANGUAGES].sort(
		(a, b) => Number(b.code === 'es') - Number(a.code === 'es')
	);

	let loading = $state<string | null>(null);
	/** Logos that did not load: the station's initial instead. */
	const broken = new SvelteSet<string>();

	/** On the TV's speakers (this device, not Snapcast); OK on the one that is on stops it. */
	async function toggle(station: RadioStation) {
		if (music.radio?.uuid === station.uuid) return music.stop();
		loading = station.uuid;
		await musicTarget.playRadio(station.uuid, false);
		loading = null;
	}
</script>

<svelte:head>
	<title>Radio · JellyCartoon</title>
</svelte:head>

<TvHeader title="Radio" />

{#if musicTarget.error}
	<p class="mb-8 rounded-lg bg-red-950 p-4 text-red-200">{musicTarget.error}</p>
{/if}

{#each languages as language (language.code)}
	<section class="mb-12">
		<h2 class="mb-4 text-3xl font-semibold">{language.label}</h2>
		<div class="grid grid-cols-3 gap-6">
			{#each STATIONS.filter((s) => s.language === language.code) as station (station.uuid)}
				{@const favicon = data.info?.[station.uuid]?.favicon}
				{@const on = music.radio?.uuid === station.uuid}
				<button
					class={[
						'flex items-center gap-5 rounded-2xl border-2 p-5 text-left transition duration-150 focus-visible:scale-105',
						on
							? 'border-emerald-400 bg-emerald-500/15'
							: 'border-white/10 bg-zinc-900 focus-visible:bg-zinc-800'
					]}
					disabled={loading !== null}
					onclick={() => toggle(station)}
				>
					{#if favicon && !broken.has(station.uuid)}
						<img
							src={favicon}
							alt=""
							class="h-20 w-20 shrink-0 rounded-xl bg-white object-contain p-1.5"
							onerror={() => broken.add(station.uuid)}
						/>
					{:else}
						<span
							class="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-zinc-800 text-4xl font-bold text-zinc-400"
							>{station.name[0]}</span
						>
					{/if}
					<span class="min-w-0">
						<span class={['block truncate text-3xl font-semibold', on && 'text-emerald-300']}>
							{loading === station.uuid ? 'Conectando…' : station.name}
						</span>
						<span class="block truncate text-xl text-zinc-400">
							{on ? '● Sonando · OK para parar' : station.description}
						</span>
						{#if !on}
							<span class="block text-lg text-zinc-500"
								>{COUNTRIES[station.country] ?? station.country}</span
							>
						{/if}
					</span>
				</button>
			{/each}
		</div>
	</section>
{/each}
