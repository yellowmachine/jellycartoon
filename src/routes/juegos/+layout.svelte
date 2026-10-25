<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/juegos', label: 'Estadísticas' },
		{ href: '/juegos/mando', label: 'Botones del mando' }
	];
	const tab = (selected: boolean) => [
		'border-b-2 px-1 pb-2 text-sm',
		selected ? 'border-lime-300 text-white' : 'border-transparent text-zinc-400 hover:text-white'
	];
</script>

<h1 class="mb-1 text-2xl font-bold">Juegos</h1>
<p class="mb-6 text-zinc-400">
	Se juegan en la Vista TV, en <a href="/tv/juegos" class="text-lime-300 underline">Juegos</a>.
	Aquí, lo de cada uno.
</p>

<!-- Tabs that are links: each view has its own address, and «back» works. -->
<nav class="mb-6 flex gap-6 border-b border-zinc-800">
	{#each tabs as t (t.href)}
		{@const selected = page.url.pathname === t.href}
		<a href={t.href} class={tab(selected)} aria-current={selected ? 'page' : undefined}>{t.label}</a
		>
	{/each}
</nav>

{@render children()}
