<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { page } from '$app/state';
	import SiteNav from 'comun/components/SiteNav.svelte';
	import { navLinks } from '#lib/nav.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/** jellycartoon's bar (#253): its sections, each where it is (nav.ts). */
	const nav = $derived(navLinks(data.webUrl));
	/** The user's initial, for their round badge (accents and all: «Á» for «Álvaro»). */
	const initial = $derived([...(data.user?.name.trim() ?? '')][0]?.toLocaleUpperCase('es') ?? '?');
	let headerHeight = $state(0);
</script>

<svelte:head>
	<title>Nube</title>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- The road mode is the whole screen, without the site around it, as at home. -->
{#if page.url.pathname === '/carretera'}
	{@render children()}
{:else}
	<div style:--header-h="{headerHeight}px">
		{#if data.user}
			<SiteNav
				bind:headerHeight
				brand={{
					href: '/',
					title: data.family ? `Nube · ${data.family.name}` : 'Nube',
					image: favicon
				}}
				links={nav.links}
				menuLinks={nav.menuLinks}
				user={{
					name: data.user.name,
					badge: 'bg-amber-500 text-sm font-semibold text-zinc-950 hover:bg-amber-400',
					mark: initial
				}}
				userLinks={nav.userLinks}
			/>
		{/if}

		<main class="mx-auto max-w-6xl px-4 py-6">
			{#if data.user && !data.family}
				<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
					Tu cuenta no está en ninguna familia. Pide a quien administra la tuya que te invite.
				</p>
			{:else}
				{@render children()}
			{/if}
		</main>
	</div>
{/if}
