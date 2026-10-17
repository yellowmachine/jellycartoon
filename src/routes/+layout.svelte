<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import SalonBar from '#lib/components/SalonBar.svelte';
	import SnapcastBar from '#lib/components/SnapcastBar.svelte';
	import TvIcon from '#lib/components/TvIcon.svelte';
	import { beforeNavigate } from '$app/navigation';
	import { page, updated } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// After an update (#20), a tab left open (the TV's /tv) still runs the old code: the next
	// navigation loads the whole page, the new version, instead. SvelteKit notices the new version on
	// server responses, when the tab is shown again, and every hour.
	// https://svelte.dev/docs/kit/configuration#version
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});

	const links = $derived([
		// With Hoy and Listas in its tabs.
		{ href: '/', label: 'Series', also: ['/series', '/today', '/lists'] },
		...(data.cinema ? [{ href: '/cine', label: 'Cine' }] : []),
		...(data.music ? [{ href: '/musica', label: 'Música' }] : []),
		{ href: '/radio', label: 'Radio' },
		// Not for a child's account yet.
		...(data.kid ? [] : [{ href: '/canales', label: 'Canales' }]),
		...(data.salon ? [{ href: '/salon', label: 'Salón' }] : []),
		...(data.voice ? [{ href: '/voz', label: 'Hablar' }] : []),
		...(data.kidsPage ? [{ href: '/infantil', label: 'Infantil' }] : []),
		// Not for a child's account: they do not exist for it.
		...(data.kid
			? []
			: // With Etiquetas and Registro in its tabs.
				[{ href: '/library', label: 'Gestión', also: ['/logs'] }])
	]);

	const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);
	/** The section a page is in: its own address or, for those with tabs, any of theirs. */
	const isCurrent = (href: string) => {
		const path = page.url.pathname;
		const also = links.find((l) => l.href === href)?.also ?? [];
		return (href === '/' ? path === '/' : under(path, href)) || also.some((h) => under(path, h));
	};
	const current = $derived(links.find((l) => l.href !== '/' && isCurrent(l.href)));

	/** The user's initial, for their round badge (accents and all: «Á» for «Álvaro»). */
	const initial = $derived([...(data.user?.name.trim() ?? '')][0]?.toLocaleUpperCase('es') ?? '?');

	/**
	 * Escape or Backspace go back, as a TV's «back» (a remote in the living room, which has no
	 * browser buttons). Not while typing, or while a dialog, a menu or fullscreen is open: Escape
	 * closes those itself.
	 */
	function back(e: KeyboardEvent) {
		if ((e.key !== 'Escape' && e.key !== 'Backspace') || e.defaultPrevented) return;
		const target = e.target as HTMLElement;
		if (target.isContentEditable || target.closest('input, textarea, select')) return;
		if (document.querySelector('dialog[open], :popover-open') || document.fullscreenElement) return;
		e.preventDefault();
		history.back();
	}

	/** The phone menu; closed when one of its links is followed. */
	let menu = $state<HTMLElement>();
</script>

<svelte:window onkeydown={back} />

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>JellyCartoon</title>
</svelte:head>

<!-- The TV view (#11) is the whole screen, without the site around it. -->
{#if page.url.pathname === '/tv' || page.url.pathname.startsWith('/tv/')}
	{@render children()}
{:else}
	{#if data.user}
		<header class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur">
			<nav class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
				<a href="/" class="flex shrink-0 items-center gap-2 text-lg font-bold text-amber-400">
					<img src={favicon} alt="" class="h-7 w-7 rounded-md" />
					JellyCartoon
				</a>
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
					<!-- The view for the living room's TV and its remote (#11): only with mpv, as Salón. -->
					{#if data.salon}
						<a
							href="/tv"
							title="Vista TV"
							aria-label="Vista TV"
							class="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
							><TvIcon name="series" class="h-6 w-6" /></a
						>
					{/if}
					<a
						href="/ajustes"
						title="{data.user.name} · Ajustes"
						aria-label="{data.user.name} · Ajustes"
						class={[
							'flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-zinc-950 hover:bg-amber-400',
							isCurrent('/ajustes') && 'ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-950'
						]}>{initial}</a
					>
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
					<a
						href="/ajustes"
						onclick={() => menu?.hidePopover()}
						class="flex items-center gap-2 py-2 text-sm text-zinc-300 hover:text-white"
					>
						<span
							class="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 font-semibold text-zinc-950"
							aria-hidden="true">{initial}</span
						>
						{data.user.name} · Ajustes
					</a>
					<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
						Salir
					</button>
				</form>
			</div>
			<!-- In the sticky header, under the menu: what is on stays in view on every page. Only with
		     a bar showing does it take room (MusicBar's <audio> is always there, but not a div). -->
			<div class="mx-auto flex max-w-6xl flex-col gap-1 px-4 has-[>div]:pb-2">
				<!-- Everywhere but its remote. -->
				{#if data.salon && !isCurrent('/salon')}
					<SalonBar />
				{/if}
				{#if data.snapcast}
					<SnapcastBar />
				{/if}
				<!-- Music, and the radio. -->
				<MusicBar />
			</div>
		</header>
		{#if data.newVersion && !isCurrent('/ajustes')}
			<a
				href="/ajustes#version"
				class="block border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-300 hover:bg-amber-500/20"
				>Hay una versión nueva de JellyCartoon, la {data.newVersion}. Ver novedades y actualizar →</a
			>
		{/if}
	{/if}

	<!-- overflow-x-clip: the "cinema" player is 100vw wide, which includes the scrollbar. -->
	<main class="mx-auto max-w-6xl overflow-x-clip px-4 py-6">
		{@render children()}
	</main>
{/if}
