<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const links = $derived([
		{ href: '/', label: 'Catálogo' },
		...(data.cinema ? [{ href: '/cine', label: 'Cine' }] : []),
		{ href: '/today', label: 'Hoy' },
		{ href: '/lists', label: 'Listas' },
		{ href: '/library', label: 'Biblioteca' },
		{ href: '/logs', label: 'Registro' }
	]);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>JellyCartoon</title>
</svelte:head>

{#if data.user}
	<header class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
		<nav class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
			<a href="/" class="text-lg font-bold text-amber-400">JellyCartoon</a>
			{#each links as link (link.href)}
				<a
					href={link.href}
					class={[
						'text-sm hover:text-white',
						page.url.pathname === link.href || page.url.pathname.startsWith(`${link.href}/`)
							? 'text-white'
							: 'text-zinc-400'
					]}>{link.label}</a
				>
			{/each}
			<form method="post" action="/logout" class="ml-auto flex items-center gap-3">
				<span class="text-sm text-zinc-400">{data.user.name}</span>
				<button class="text-sm text-zinc-400 hover:text-white">Salir</button>
			</form>
		</nav>
	</header>
{/if}

<!-- overflow-x-clip: the "cinema" player is 100vw wide, which includes the scrollbar. -->
<main class="mx-auto max-w-6xl overflow-x-clip px-4 py-6">
	{@render children()}
</main>
