<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	/** Series, today's and the lists: all of episodes, under Series as Música has its tabs. */
	const tabs = [
		{ href: '/', label: 'Series', match: (p: string) => p === '/' || p.startsWith('/series/') },
		{ href: '/today', label: 'Hoy', match: (p: string) => p === '/today' },
		{
			href: '/lists',
			label: 'Listas',
			match: (p: string) => p === '/lists' || p.startsWith('/lists/')
		}
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
