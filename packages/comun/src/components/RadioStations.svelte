<script lang="ts">
	import type { Snippet } from 'svelte';
	import { music } from '../music-player.svelte.ts';
	import { musicTarget } from '../music-target.svelte.ts';
	import {
		COUNTRIES,
		LANGUAGES,
		STATIONS,
		type Headline,
		type RadioStation,
		type RadioStationInfo
	} from '../radio.ts';

	/**
	 * The stations (#58), the same in the house and in the cloud (#253): each one played here, or in
	 * the whole house (`snapcast`, at home, with its `switcher`). `info`, how each did in Radio
	 * Browser's last check; null, it could not be asked. `headlines`, where the playing station's
	 * headlines are asked for (#387, Seilide's `/radio/titulares`): without it, none are shown.
	 */
	let {
		info,
		snapcast = false,
		switcher,
		headlines
	}: {
		info: Record<string, RadioStationInfo> | null;
		snapcast?: boolean;
		switcher?: Snippet;
		headlines?: string;
	} = $props();

	/** The station playing, if it has its broadcaster's feed. */
	const withNews = $derived(
		headlines ? STATIONS.find((s) => s.uuid === music.radio?.uuid && s.feed) : undefined
	);
	let news = $state<{ uuid: string; list: Headline[] } | null>(null);
	let newsFailed = $state(false);

	// Asked again for each station that starts; the server keeps them a while.
	$effect(() => {
		const station = withNews;
		if (!station || !headlines) return;
		const controller = new AbortController();
		newsFailed = false;
		fetch(`${headlines}/${station.uuid}`, { signal: controller.signal })
			.then((res) => (res.ok ? (res.json() as Promise<Headline[]>) : Promise.reject(res.status)))
			.then((list) => (news = { uuid: station.uuid, list }))
			.catch(() => {
				if (!controller.signal.aborted) newsFailed = true;
			});
		return () => controller.abort();
	});

	/** «hace 5 min», «hace 3 h», or the day. */
	function ago(at: string | null) {
		if (!at) return '';
		const minutes = Math.round((Date.now() - Date.parse(at)) / 60_000);
		if (minutes < 1) return 'ahora';
		if (minutes < 60) return `hace ${minutes} min`;
		if (minutes < 24 * 60) return `hace ${Math.round(minutes / 60)} h`;
		return new Date(at).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
	}

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

{#if withNews}
	<!-- The playing station's headlines (#387): each one on its broadcaster's site. -->
	<section class="mb-8 rounded-md border border-zinc-800 p-4" aria-live="polite">
		<h2 class="mb-3 font-semibold">Titulares de {withNews.name}</h2>
		{#if news?.uuid === withNews.uuid && news.list.length}
			<ul class="flex flex-col gap-2">
				{#each news.list as h (h.link)}
					<li>
						<a
							href={h.link}
							target="_blank"
							rel="noreferrer"
							class="group flex items-baseline gap-3"
						>
							<span class="min-w-0 flex-1 group-hover:underline">{h.title}</span>
							<span class="shrink-0 text-xs text-zinc-500">{ago(h.at)}</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else if newsFailed || news?.uuid === withNews.uuid}
			<p class="text-sm text-zinc-400">Ahora mismo no se pueden traer sus titulares.</p>
		{:else}
			<p class="text-sm text-zinc-400">Trayendo sus titulares…</p>
		{/if}
	</section>
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
