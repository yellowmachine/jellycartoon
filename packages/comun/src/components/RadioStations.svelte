<script lang="ts">
	import type { Snippet } from 'svelte';
	import { music } from '../music-player.svelte.ts';
	import { musicTarget } from '../music-target.svelte.ts';
	import {
		COUNTRIES,
		LANGUAGES,
		STATIONS,
		type RadioStation,
		type RadioStationInfo
	} from '../radio.ts';

	/**
	 * The stations (#58), the same in the house and in the cloud (#253): each one played here, or in
	 * the whole house (`snapcast`, at home, with its `switcher`). `info`, how each did in Radio
	 * Browser's last check; null, it could not be asked.
	 */
	let {
		info,
		snapcast = false,
		switcher
	}: {
		info: Record<string, RadioStationInfo> | null;
		snapcast?: boolean;
		switcher?: Snippet;
	} = $props();

	let loading = $state<string | null>(null);

	/** Only where Snapcast is set up; elsewhere, always this device. */
	const toSnapcast = $derived(snapcast && musicTarget.value === 'snapcast');

	async function play(station: RadioStation) {
		loading = station.uuid;
		await musicTarget.playRadio(station.uuid, toSnapcast);
		loading = null;
	}
</script>

<p class="mb-6 text-sm text-zinc-400">
	Emisoras de otros países, en directo. Las habladas van primero: son las mejores para acostumbrar
	el oído a un idioma.
</p>
{#if !info}
	<p class="mb-4 text-sm text-amber-400">
		No se puede consultar Radio Browser ahora mismo: puede que no suenen.
	</p>
{/if}
{#if snapcast && switcher}
	<div class="mb-6">{@render switcher()}</div>
{:else if musicTarget.error}
	<p class="mb-4 text-sm text-red-400">{musicTarget.error}</p>
{/if}

{#each LANGUAGES as language (language.code)}
	<section class="mb-8">
		<h2 class="mb-3 text-lg font-semibold">{language.label}</h2>
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each STATIONS.filter((s) => s.language === language.code) as station (station.uuid)}
				{@const checked = info?.[station.uuid]}
				{@const on = music.radio?.uuid === station.uuid}
				<button
					class={[
						'flex items-center gap-3 rounded-md border p-3 text-left hover:bg-zinc-900',
						on ? 'border-amber-500' : 'border-zinc-800'
					]}
					disabled={loading !== null}
					onclick={() => play(station)}
				>
					{#if checked?.favicon}
						<img
							src={checked.favicon}
							alt=""
							class="h-12 w-12 shrink-0 rounded bg-white object-contain p-1"
							onerror={(e) => e.currentTarget.classList.add('invisible')}
						/>
					{:else}
						<span
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-zinc-800 text-xl"
							>📻</span
						>
					{/if}
					<span class="min-w-0 flex-1">
						<span class={['block truncate font-medium', on && 'text-amber-400']}>
							{loading === station.uuid ? 'Conectando…' : station.name}
						</span>
						<span class="block truncate text-xs text-zinc-400">{station.description}</span>
						<span class="block text-xs text-zinc-500">
							{COUNTRIES[station.country] ?? station.country} · {station.kind === 'talk'
								? 'Hablada'
								: 'Música'}
							{#if checked && !checked.ok}
								· <span class="text-amber-400">falló en la última comprobación</span>
							{/if}
						</span>
					</span>
					<span class="shrink-0 text-zinc-500">{on && music.playing ? '♪' : '▶︎'}</span>
				</button>
			{/each}
		</div>
	</section>
{/each}

<p class="text-xs text-zinc-500">
	Emisoras y logos de <a
		href="https://www.radio-browser.info"
		class="hover:underline"
		target="_blank"
		rel="noreferrer">Radio Browser</a
	>.
</p>
