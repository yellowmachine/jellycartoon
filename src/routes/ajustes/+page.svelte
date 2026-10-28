<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import SettingsSearch from '#lib/components/SettingsSearch.svelte';
	import { OLD_TABS, SETTINGS_INDEX, TAB_LABELS, type SettingsTab } from '#lib/settings-index.ts';
	import Reproduccion from './Reproduccion.svelte';
	import ModoDj from './ModoDj.svelte';
	import GastoIa from './GastoIa.svelte';
	import LoQueSeGuarda from './LoQueSeGuarda.svelte';
	import Colores from './Colores.svelte';
	import AlAbrir from './AlAbrir.svelte';
	import Langua from './Langua.svelte';
	import Telegram from './Telegram.svelte';
	import MusicaEnApps from './MusicaEnApps.svelte';
	import Dispositivo from './Dispositivo.svelte';
	import Voz from './Voz.svelte';
	import MusicaAqui from './MusicaAqui.svelte';
	import Ia from './Ia.svelte';
	import Etiquetas from './Etiquetas.svelte';
	import Rutas from './Rutas.svelte';
	import CompartirViajes from './CompartirViajes.svelte';
	import Satelites from './Satelites.svelte';
	import Nube from './Nube.svelte';
	import DondeCasa from './DondeCasa.svelte';
	import VozCasa from './VozCasa.svelte';
	import Personas from './Personas.svelte';
	import Version from './Version.svelte';
	import Cuenta from './Cuenta.svelte';
	import DosPasos from './DosPasos.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * By whom it is for (#178): what is yours wherever you are, what is only this browser's, what is
	 * the whole house's, and the account.
	 */
	const tabs: { id: SettingsTab; label: string }[] = (
		['mi', 'aparato', 'casa', 'cuenta'] as const
	).map((id) => ({ id, label: TAB_LABELS[id] }));
	const tab = $derived.by(() => {
		const asked = page.url.searchParams.get('seccion');
		return tabs.find((t) => t.id === asked)?.id ?? (asked && OLD_TABS[asked]) ?? 'mi';
	});

	// A link from before #178 (`?seccion=aspecto#microfono`): its section, in the tab it is in now.
	onMount(() => {
		const asked = page.url.searchParams.get('seccion');
		if (!asked || !(asked in OLD_TABS)) return;
		const id = location.hash.slice(1);
		const now = SETTINGS_INDEX.find((e) => e.id === id)?.tab ?? OLD_TABS[asked];
		const url = new URL(location.href);
		url.searchParams.set('seccion', now!);
		void goto(url, { replaceState: true }).then(() =>
			document.getElementById(id)?.scrollIntoView({ block: 'start' })
		);
	});
</script>

<svelte:head>
	<title>Ajustes · JellyCartoon</title>
</svelte:head>

<div class="settings mx-auto max-w-2xl">
	<h1 class="mb-4 text-2xl font-bold">Ajustes</h1>

	<!-- The search and the tabs stay in view under the app's bar while scrolling (#178), as high as
	     the bar is on this screen (--header-h, measured by the layout). -->
	<div
		class="sticky z-[5] -mx-4 mb-6 bg-zinc-950/90 px-4 pt-2 backdrop-blur"
		style:top="var(--header-h, 0px)"
	>
		<!-- What is in any tab, by a word (settings-index.ts): the page only draws the open one. -->
		<SettingsSearch
			shown={{
				kid: Boolean(data.kid),
				intro: data.intro,
				keepHistory: data.keepHistory,
				recordTrips: data.recordTrips,
				langua: data.langua,
				telegram: data.telegram,
				musicApps: data.musicApps,
				voice: Boolean(data.voice),
				music: Boolean(data.music),
				ai: data.ai,
				spendLine: data.spendLine,
				labels: data.labels,
				routes: data.routes,
				relay: data.relay,
				satellites: data.satellites,
				cloudKeys: data.cloudKeys,
				home: data.home,
				houseVoice: data.houseVoice,
				kids: data.kids,
				twoFactor: data.twoFactor
			}}
		/>

		<!-- Tabs that are links, as in Gestión: each keeps its address, and «back» works. -->
		<!-- Forms post to «?seccion=…&/action», so saving keeps the tab (the action is the «/» one). -->
		<nav class="flex gap-5 overflow-x-auto border-b border-zinc-800">
			{#each tabs as t (t.id)}
				<a
					href="?seccion={t.id}"
					class={[
						'shrink-0 border-b-2 px-1 pb-2 text-sm',
						t.id === tab
							? 'border-amber-500 text-white'
							: 'border-transparent text-zinc-400 hover:text-white'
					]}
					aria-current={t.id === tab ? 'page' : undefined}>{t.label}</a
				>
			{/each}
		</nav>
	</div>

	{#if tab === 'mi'}
		<p class="mb-6 text-sm text-zinc-400">Solo para ti, en todos tus aparatos.</p>

		<Reproduccion {data} {form} {tab} />

		<ModoDj {data} {tab} />

		<LoQueSeGuarda {data} {tab} />

		<Colores {data} {form} {tab} />

		<AlAbrir {data} {tab} />

		<GastoIa {data} {tab} />

		<Langua {data} {form} {tab} />

		<Telegram {data} {form} {tab} />

		<MusicaEnApps {data} {form} {tab} />
	{/if}

	{#if tab === 'aparato'}
		<p class="mb-6 text-sm text-zinc-400">
			Solo en este móvil, tablet u ordenador: en otro puede ser distinto.
		</p>

		<Dispositivo {data} />

		<Voz {data} />

		<MusicaAqui {data} />
	{/if}

	{#if tab === 'casa'}
		<p class="mb-6 text-sm text-zinc-400">Para toda la casa.</p>

		<Ia {data} {form} {tab} />

		<Etiquetas {data} {form} {tab} />

		<Rutas {data} {form} {tab} />

		<CompartirViajes {data} {form} {tab} />

		<DondeCasa {data} {form} {tab} />

		<Satelites {data} {form} {tab} />

		<Nube {data} {form} {tab} />

		<VozCasa {data} {form} {tab} />

		<Personas {data} {form} {tab} />

		<Version {data} {form} {tab} />
	{/if}

	{#if tab === 'cuenta'}
		<Cuenta {data} {form} {tab} />
		<DosPasos {data} {form} {tab} />
	{/if}
</div>

<style>
	/* A section opened from the search or a link: its start below the bar and the tabs that stick. */
	.settings :global([id]) {
		scroll-margin-top: calc(var(--header-h, 0px) + 7rem);
	}
</style>
