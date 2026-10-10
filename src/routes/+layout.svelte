<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const links = $derived([
		{ href: '/', label: 'Catálogo' },
		...(data.cinema ? [{ href: '/cine', label: 'Cine' }] : []),
		...(data.salon ? [{ href: '/salon', label: 'Salón' }] : []),
		{ href: '/today', label: 'Hoy' },
		{ href: '/lists', label: 'Listas' },
		{ href: '/library', label: 'Biblioteca' },
		{ href: '/logs', label: 'Registro' }
	]);

	const isCurrent = (href: string) =>
		href === '/'
			? page.url.pathname === '/'
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	const current = $derived(links.find((l) => l.href !== '/' && isCurrent(l.href)));

	/** The phone menu; closed when one of its links is followed. */
	let menu = $state<HTMLElement>();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>JellyCartoon</title>
</svelte:head>

{#if data.user}
	<header class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
		<nav class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
			<a href="/" class="text-lg font-bold text-amber-400">JellyCartoon</a>
			<!-- Wide screens: every link in a row. -->
			{#each links as link (link.href)}
				<a
					href={link.href}
					class={[
						'hidden text-sm hover:text-white lg:inline',
						isCurrent(link.href) ? 'text-white' : 'text-zinc-400'
					]}>{link.label}</a
				>
			{/each}
			<form method="post" action="/logout" class="ml-auto hidden items-center gap-3 lg:flex">
				<span class="text-sm text-zinc-400">{data.user.name}</span>
				<button class="text-sm text-zinc-400 hover:text-white">Salir</button>
			</form>

			<!-- Phone: the section you are in and a menu with the rest. -->
			{#if current}
				<span class="-ml-3 truncate text-sm text-zinc-300 lg:hidden">{current.label}</span>
			{/if}
			<button
				class="ml-auto rounded-md px-2 py-1 text-xl text-zinc-300 hover:bg-zinc-800 lg:hidden"
				aria-label="Menú"
				popovertarget="site-menu">☰</button
			>
		</nav>
		<div
			bind:this={menu}
			id="site-menu"
			popover="auto"
			class="inset-x-0 top-14 bottom-auto m-0 w-auto border-b border-zinc-800 bg-zinc-950 px-4 pb-4 text-zinc-100 shadow-lg lg:hidden"
		>
			<ul class="divide-y divide-zinc-800">
				{#each links as link (link.href)}
					<li>
						<a
							href={link.href}
							onclick={() => menu?.hidePopover()}
							class={[
								'block py-3 text-base',
								isCurrent(link.href) ? 'text-amber-400' : 'text-zinc-200'
							]}>{link.label}</a
						>
					</li>
				{/each}
			</ul>
			<form method="post" action="/logout" class="mt-2 flex items-center justify-between">
				<span class="text-sm text-zinc-400">{data.user.name}</span>
				<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
					Salir
				</button>
			</form>
		</div>
	</header>
{/if}

<!-- overflow-x-clip: the "cinema" player is 100vw wide, which includes the scrollbar. -->
<main class="mx-auto max-w-6xl overflow-x-clip px-4 py-6">
	{@render children()}
</main>
