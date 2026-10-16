<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import SalonBar from '#lib/components/SalonBar.svelte';
	import SnapcastBar from '#lib/components/SnapcastBar.svelte';
	import TvIcon from '#lib/components/TvIcon.svelte';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const links = $derived([
		{ href: '/', label: 'Series' },
		...(data.cinema ? [{ href: '/cine', label: 'Cine' }] : []),
		...(data.music ? [{ href: '/musica', label: 'Música' }] : []),
		{ href: '/radio', label: 'Radio' },
		...(data.salon ? [{ href: '/salon', label: 'Salón' }] : []),
		{ href: '/today', label: 'Hoy' },
		{ href: '/lists', label: 'Listas' },
		...(data.kidsPage ? [{ href: '/infantil', label: 'Infantil' }] : []),
		// Not for a child's account: they do not exist for it.
		...(data.kid
			? []
			: [
					{ href: '/library', label: 'Gestión' },
					{ href: '/logs', label: 'Registro' }
				])
	]);

	const isCurrent = (href: string) =>
		href === '/'
			? page.url.pathname === '/'
			: page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
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
	{/if}

	<!-- overflow-x-clip: the "cinema" player is 100vw wide, which includes the scrollbar. -->
	<main class="mx-auto max-w-6xl overflow-x-clip px-4 py-6">
		{@render children()}
	</main>
{/if}
