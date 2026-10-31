<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import AlarmBanner from 'comun/components/AlarmBanner.svelte';
	import KidRequests from '#lib/components/KidRequests.svelte';
	import SiteNav from 'comun/components/SiteNav.svelte';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import AiSpendLine from 'comun/components/AiSpendLine.svelte';
	import VoiceBubble from '#lib/components/VoiceBubble.svelte';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { navLinks } from '#lib/nav.ts';
	import { themeColor, themeCss } from 'comun/themes.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/** jellycartoon's bar (#253): the cloud's sections (nav.ts). */
	const nav = $derived(
		navLinks(data.user?.serviceAdmin, data.hasHouse, data.family?.kid ?? false, data.guardian)
	);
	/** The user's initial, for their round badge (accents and all: «Á» for «Álvaro»). */
	const initial = $derived([...(data.user?.name.trim() ?? '')][0]?.toLocaleUpperCase('es') ?? '?');
	let headerHeight = $state(0);

	// A device that keeps routes' maps (#164): what it was ordered from any other, done now.
	onMount(() => {
		if (data.user)
			void import('comun/route-maps.svelte.ts').then(({ routeMaps }) => routeMaps.sync());
	});

	/**
	 * The header's microphone (#253), as jellycartoon's: held a moment, it listens, and let go, what
	 * was said is sent; a tap opens Hablar (/voz). With taps (Ajustes), the other way round: a tap
	 * starts or sends, and held this long Hablar opens.
	 */
	const HOLD_MS = 250;
	const OPEN_MS = 600;
	/** Pressed, and not yet long enough to listen: a tap so far. */
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	/** Listening: let go, and what was said is sent. */
	let holding = false;

	/** A tap does not wake the microphone (nor ask for its permission): only holding it does. */
	function pressMic() {
		clearTimeout(holdTimer);
		if (micMode.tap) {
			holdTimer = setTimeout(() => {
				holdTimer = undefined;
				void goto('/voz');
			}, OPEN_MS);
			return;
		}
		holdTimer = setTimeout(() => {
			holdTimer = undefined;
			holding = true;
			void voice.start();
		}, HOLD_MS);
	}

	function releaseMic(cancelled: boolean) {
		if (micMode.tap) {
			// Held: Hablar opened. A tap: it starts, or sends.
			if (holdTimer === undefined) return;
			clearTimeout(holdTimer);
			holdTimer = undefined;
			if (!cancelled) voice.toggle();
			return;
		}
		if (holdTimer !== undefined) {
			clearTimeout(holdTimer);
			holdTimer = undefined;
			if (!cancelled) void goto('/voz');
			return;
		}
		if (!holding) return;
		holding = false;
		voice.stop();
	}

	/**
	 * Ctrl+Shift+Space, held: the same as holding the microphone, from any page (in a text box too:
	 * it types nothing). Ctrl+Space switches the keyboard's language on Linux and macOS, and
	 * Alt+Space opens the window's menu on Windows and KDE.
	 */
	const isVoiceKey = (e: KeyboardEvent) => e.code === 'Space' && e.ctrlKey && e.shiftKey;
	let keyHolding = false;

	function voiceKeyDown(e: KeyboardEvent) {
		if (!data.user || data.family?.kid || !isVoiceKey(e)) return;
		e.preventDefault();
		if (e.repeat || keyHolding) return;
		// With taps (Ajustes): once to start, once more to send.
		if (micMode.tap) return void voice.toggle();
		keyHolding = true;
		void voice.start();
	}

	/** Letting go of any of the three sends what was said; so does leaving the window. */
	function voiceKeyUp(e?: KeyboardEvent) {
		if (!keyHolding) return;
		if (e && e.code !== 'Space' && e.key !== 'Control' && e.key !== 'Shift') return;
		keyHolding = false;
		voice.stop();
	}

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

<svelte:window onkeydown={voiceKeyDown} onkeyup={voiceKeyUp} onblur={() => voiceKeyUp()} />

<svelte:head>
	<title>Seilide</title>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content={themeColor(data.theme)} />
	<!-- Their colours (Ajustes), as at home: values only from the themes' table. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a <style> made from the themes' own table, never from what was typed. -->
	{@html themeCss(data.theme)}
</svelte:head>

<!-- The road mode is the whole screen, without the site around it, as at home; and a shared
trip's link (#81), for whoever has it. -->
{#if page.url.pathname === '/carretera' || page.url.pathname.startsWith('/s/')}
	{@render children()}
{:else}
	<div style:--header-h="{headerHeight}px">
		{#if data.user}
			<SiteNav
				bind:headerHeight
				brand={{
					href: '/',
					title: data.family ? `Seilide · ${data.family.name}` : 'Seilide',
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
					<!-- Not for a child (#303): the voice is the grown-ups'. -->
					{#if !data.family?.kid}
						<a
							href="/voz"
							title={micMode.tap
								? 'Toca para hablar y otra vez para enviar (o Ctrl+Mayús+Espacio) · Mantén pulsado para abrir Hablar'
								: 'Mantén pulsado para hablar (o Ctrl+Mayús+Espacio) · Pulsa para abrir Hablar'}
							aria-label="Hablar"
							aria-current={page.url.pathname === '/voz' ? 'page' : undefined}
							draggable="false"
							style="-webkit-touch-callout: none"
							class={[
								'-ml-3 shrink-0 touch-none rounded-md p-1 select-none hover:bg-zinc-800 hover:text-white',
								voice.phase === 'listening'
									? 'bg-red-500 text-white hover:bg-red-500'
									: page.url.pathname === '/voz'
										? 'text-amber-400'
										: 'text-zinc-400'
							]}
							onpointerdown={(e) => {
								if (e.button !== 0) return;
								e.currentTarget.setPointerCapture(e.pointerId);
								pressMic();
							}}
							onpointerup={() => releaseMic(false)}
							onpointercancel={() => releaseMic(true)}
							onclick={(e) => {
								// The pointer's own handlers go or talk; only the keyboard (Enter) follows the link.
								if (e.detail !== 0) e.preventDefault();
							}}
							oncontextmenu={(e) => e.preventDefault()}
						>
							<svg viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor" aria-hidden="true">
								<rect x="9" y="2.5" width="6" height="12" rx="3" />
								<path
									d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						</a>
						<!-- A receipt's photo for Gastos (#194), at once: on phones and tablets, with their camera; a
					     PC has the button in Gastos. The photo is read there. As at home. -->
						{#if data.receipts}
							<label
								title="Foto de un ticket, para Gastos"
								aria-label="Foto de un ticket"
								class="hidden shrink-0 cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white pointer-coarse:block"
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
									<path
										d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"
									/>
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
					{/if}
				{/snippet}
				{#snippet below()}
					<div class="mx-auto flex max-w-6xl flex-col gap-1 px-4 has-[>div]:pb-2">
						<!-- What the header's microphone heard and answered; Hablar shows it big itself. -->
						{#if page.url.pathname !== '/voz'}
							<VoiceBubble />
						{/if}
						<!-- The radio and the podcasts (#253), going on from page to page, as at home. -->
						<MusicBar />
						<!-- The AI's spending (#193), if they asked for it in Ajustes, as at home. -->
						{#if data.spendLine}
							<AiSpendLine />
						{/if}
					</div>
				{/snippet}
			</SiteNav>
			<!-- An alarm ringing in the house (#241), with «Parar»: wherever it sounds. -->
			{#if data.family}
				<AlarmBanner />
			{/if}
			<!-- A child asking to enter on the family's device (#303), to its adults. -->
			{#if data.guardian}
				<KidRequests />
			{/if}
		{/if}

		<main class="mx-auto max-w-6xl px-4 py-6">
			<!-- Without a family, only an invitation's page: the way into one. -->
			{#if data.user && !data.family && !page.url.pathname.startsWith('/invitacion/')}
				<p class="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
					Tu cuenta no está en ninguna familia. Pide a quien administra la tuya que te invite, y
					abre el enlace del correo.
				</p>
			{:else}
				{@render children()}
			{/if}
		</main>
	</div>
{/if}
