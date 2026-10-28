<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import AlarmBanner from 'comun/components/AlarmBanner.svelte';
	import SiteNav from 'comun/components/SiteNav.svelte';
	import { navLinks } from '#lib/nav.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/** jellycartoon's bar (#253): its sections, each where it is (nav.ts). */
	const nav = $derived(navLinks(data.webUrl));
	/** The user's initial, for their round badge (accents and all: «Á» for «Álvaro»). */
	const initial = $derived([...(data.user?.name.trim() ?? '')][0]?.toLocaleUpperCase('es') ?? '?');
	let headerHeight = $state(0);

	// A notice touched (Web Push, the service worker): its page, here, without loading again.
	onMount(() => {
		if (!('serviceWorker' in navigator)) return;
		const went = (e: MessageEvent) => {
			const to = e.data?.goto;
			if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//')) return;
			void goto(to);
			// The service worker waits for this: without it, it takes the page there itself.
			e.ports[0]?.postMessage('ok');
		};
		navigator.serviceWorker.addEventListener('message', went);
		return () => navigator.serviceWorker.removeEventListener('message', went);
	});
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
			>
				{#snippet leading()}
					<!-- A receipt's photo for Gastos (#194), at once: on phones and tablets, with their camera; a
					     PC has the button in Gastos. The photo is read there. As at home. -->
					{#if data.receipts}
						<label
							title="Foto de un ticket, para Gastos"
							aria-label="Foto de un ticket"
							class="-ml-3 hidden shrink-0 cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white pointer-coarse:block"
						>
							<svg
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="h-6 w-6"
								aria-hidden="true"
							>
								<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
								<path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
								<path d="M12 17.5v-11" />
							</svg>
							<input
								type="file"
								accept="image/*"
								capture="environment"
								class="hidden"
								onchange={(e) => {
									const photo = e.currentTarget.files?.[0];
									e.currentTarget.value = '';
									if (!photo) return;
									pendingReceipt.photo = photo;
									if (page.url.pathname !== '/gastos') void goto('/gastos');
								}}
							/>
						</label>
					{/if}
				{/snippet}
			</SiteNav>
			<!-- An alarm ringing in the house (#241), with «Parar»: wherever it sounds. -->
			{#if data.family}
				<AlarmBanner />
			{/if}
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
