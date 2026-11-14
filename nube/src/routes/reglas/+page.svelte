<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import { page } from '$app/state';
	import Reglas from './Reglas.svelte';
	import VozRecuerda from './VozRecuerda.svelte';
	import VozAprendido from './VozAprendido.svelte';
	import type { PageProps } from './$types';

	/**
	 * Reglas y memoria, out of Ajustes (they had grown past a setting): the rules with «¿Qué
	 * pasaría…?», and what the voice remembers (and, to its administrator, what it learned).
	 * Tabs that are links, as in Ajustes: forms post to «?ver=…&/action», so saving keeps the tab.
	 */
	let { data, form }: PageProps = $props();

	const tabs = [
		{ id: 'reglas', label: 'Reglas' },
		{ id: 'memoria', label: 'Memoria' }
	] as const;
	const tab = $derived(tabs.find((t) => t.id === page.url.searchParams.get('ver'))?.id ?? 'reglas');
</script>

<svelte:head>
	<title>Reglas · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-4 text-2xl font-bold">
		Reglas<GuideLink page="voz#reglas-que-avise-sola" label="las reglas" />
	</h1>

	<nav class="mb-6 flex gap-5 overflow-x-auto border-b border-zinc-800">
		{#each tabs as t (t.id)}
			<a
				href="?ver={t.id}"
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

	{#if tab === 'reglas'}
		<Reglas {data} {form} {tab} />
	{:else}
		<VozRecuerda {data} {form} {tab} />

		<VozAprendido {data} {tab} />
	{/if}
</div>
