<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/**
	 * Looking after the app, in one place: the videos' conversion, the tags, the subtitles Whisper
	 * makes, the episodes the vision model labels, what the cloud did not get and the log.
	 */
	const tabs = [
		{ href: '/library', label: 'Conversión', match: (p: string) => p === '/library' },
		{
			href: '/library/etiquetas',
			label: 'Etiquetas',
			match: (p: string) => p === '/library/etiquetas'
		},
		{
			href: '/library/subtitulos',
			label: 'Subtítulos',
			match: (p: string) => p === '/library/subtitulos'
		},
		{
			href: '/library/etiquetado',
			label: 'Etiquetado',
			match: (p: string) => p === '/library/etiquetado'
		},
		{ href: '/library/nube', label: 'Nube', match: (p: string) => p === '/library/nube' },
		{ href: '/logs', label: 'Registro', match: (p: string) => p === '/logs' }
	];
	const selected = $derived(tabs.find((t) => t.match(page.url.pathname)));
	const tab = (on: boolean) => [
		'border-b-2 px-1 pb-2 text-sm',
		on ? 'border-amber-500 text-white' : 'border-transparent text-zinc-400 hover:text-white'
	];
</script>

<!-- Tabs that are links: each view keeps its own address, and «back» works. -->
<nav class="mb-6 flex gap-6 border-b border-zinc-800">
	{#each tabs as t (t.href)}
		<a href={t.href} class={tab(t === selected)} aria-current={t === selected ? 'page' : undefined}
			>{t.label}</a
		>
	{/each}
</nav>

{@render children()}
