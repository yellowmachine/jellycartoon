<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const tabs = [
		{ href: '/juegos', label: 'Jugar' },
		{ href: '/juegos/estadisticas', label: 'Estadísticas' },
		{ href: '/juegos/mando', label: 'Botones del mando' },
		{ href: '/juegos/shaders', label: 'Shaders' }
	];
	const tab = (selected: boolean) => [
		'border-b-2 px-1 pb-2 text-sm',
		selected ? 'border-lime-300 text-white' : 'border-transparent text-zinc-400 hover:text-white'
	];
</script>

<h1 class="mb-1 text-2xl font-bold">Juegos</h1>
<p class="mb-6 text-zinc-400">
	Aquí, en el navegador, con un mando o con botones en la pantalla; o en la
	<a href="/tv/juegos" class="text-lime-300 underline">Vista TV</a>.
</p>

<!-- Tabs that are links: each view has its own address, and «back» works. -->
<nav class="mb-6 flex gap-6 overflow-x-auto border-b border-zinc-800">
	{#each tabs as t (t.href)}
		{@const selected = page.url.pathname === t.href}
		<a
			href={t.href}
			class={[tab(selected), 'shrink-0']}
			aria-current={selected ? 'page' : undefined}>{t.label}</a
		>
	{/each}
</nav>

{@render children()}
