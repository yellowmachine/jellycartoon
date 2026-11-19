<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { version } from '$app/env';
	import { afterNavigate, goto, pushState } from '$app/navigation';
	import { navigating, page } from '$app/state';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import { installApp } from '#lib/install-app.svelte.ts';
	import AlarmBanner from 'comun/components/AlarmBanner.svelte';
	import KidRequests from '#lib/components/KidRequests.svelte';
	import AiStoppedBanner from '#lib/components/AiStoppedBanner.svelte';
	import SiteNav from 'comun/components/SiteNav.svelte';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import AiSpendLine from 'comun/components/AiSpendLine.svelte';
	import VoiceBubble from '#lib/components/VoiceBubble.svelte';
	import VistaScreen from '#lib/components/VistaScreen.svelte';
	import TimerBar from '#lib/components/TimerBar.svelte';
	import WalkBar from '#lib/components/WalkBar.svelte';
	import SectionIcon from 'comun/components/SectionIcon.svelte';
	import Caracol from '#lib/components/Caracol.svelte';
	import CallButton from '#lib/components/CallButton.svelte';
	import ChatPanel from '#lib/components/ChatPanel.svelte';
	import { chatPanel } from '#lib/chat-panel.svelte.ts';
	import { inVista, videoPlaying, vista } from '#lib/vista.svelte.ts';
	import { shouldGoBack } from '#lib/vista-idle.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { timers } from '#lib/timers.svelte.ts';
	import { navLinks, sectionOfPath } from '#lib/nav.ts';
	import { themeColor, themeCss } from 'comun/themes.ts';
	import { backKey, goBack } from 'comun/back.ts';
	import ShareBar from '#lib/components/ShareBar.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	/**
	 * The snail while going to another page takes a while (/musica from outside, through the
	 * house): SvelteKit's `navigating` (https://svelte.dev/docs/kit/$app-state#navigating), shown
	 * only after a moment, so a quick change does not flash it.
	 */
	const SLOW_MS = 400;
	let slow = $state(false);
	$effect(() => {
		if (!navigating.to) {
			slow = false;
			return;
		}
		const timer = setTimeout(() => (slow = true), SLOW_MS);
		return () => clearTimeout(timer);
	});

	/** jellycartoon's bar (#253): the cloud's sections (nav.ts). */
	const nav = $derived(
		navLinks(
			data.user?.serviceAdmin,
			data.hasHouse,
			data.family?.kid ?? false,
			data.guardian,
			data.family?.prayer ?? false,
			data.family?.sections,
			data.family?.mine
		)
	);
	/** The user's initial, for their round badge (accents and all: «Á» for «Álvaro»). */
	const initial = $derived([...(data.user?.name.trim() ?? '')][0]?.toLocaleUpperCase('es') ?? '?');
	let headerHeight = $state(0);
	/** The voice is the grown-ups' (#303), and with it the Vista (#525, was the kitchen's, #60). */
	const voiceOn = $derived(Boolean(data.user && data.family && !data.family.kid));
	/** The Vista's screen (#525): on, in its own page or a section it shows on its right. */
	const vistaShown = $derived(voiceOn && vista.on && inVista(page.url.pathname));
	// As it was left on this device; a «pantalla de casa» starts in it.
	$effect(() => {
		if (voiceOn) vista.load();
	});
	// A «pantalla de casa» (#525) left elsewhere untouched goes back to the Vista by itself.
	$effect(() => {
		if (!voiceOn || !vista.homeScreen) return;
		const check = setInterval(() => {
			if (inVista(location.pathname) && vista.on) return;
			const goBack = shouldGoBack({
				idleMs: Date.now() - vista.touchedAt,
				videoPlaying: videoPlaying(),
				voiceBusy: voice.phase !== 'idle' || voice.speaking,
				ringing: timers.ringing.length > 0
			});
			if (goBack) void vista.enter();
		}, 5000);
		return () => clearInterval(check);
	});
	// Locked (#532): Android's back on the Vista's home or recipe would close the installed app.
	// One more entry there, put back each time back takes it.
	$effect(() => {
		if (vista.kiosk && ['/vista', '/cocina'].includes(page.url.pathname) && !page.state.vistaGuard)
			pushState('', { vistaGuard: true });
	});
	// The family's word, kept on the device for when there is no connection.
	$effect(() => {
		if (data.family) wakeWord.setFamilyWord(data.family.wakeWord);
	});
	// The wake word in the Vista (#60): while it is on and it is turned on there, on any
	// page. Carretera has its own (its page says when).
	$effect(() => {
		if (page.url.pathname === '/carretera') return;
		wakeWord.want(Boolean(voiceOn && vista.on && wakeWord.on.cocina));
	});
	/**
	 * «Botón de llamar siempre a mano» (#330), if theirs is on: not where a call already is, nor over
	 * a game or a video, which take the whole screen.
	 */
	const callButtonShown = $derived(
		Boolean(data.callButton && data.family) &&
			!/^\/(llamadas?|watch|juegos\/)/.test(page.url.pathname)
	);
	/**
	 * Installed, the app has no browser buttons («standalone» in the manifest), and an iPhone no back
	 * gesture either: its own arrow in the bar, but on the home page.
	 */
	/**
	 * «Preguntar» beside any page (#504), on a wide screen: for whoever has it in their bar (not the
	 * children, nor with the section off). Not on its own page, which is the same chat.
	 */
	const chatOn = $derived(nav.menuLinks.some((l) => l.href === '/preguntar'));
	const chatShown = $derived(chatOn && chatPanel.open && page.url.pathname !== '/preguntar');

	const installed = new MediaQuery('(display-mode: standalone)', false);
	const backShown = $derived(installed.current && page.url.pathname !== '/');

	// A device that keeps routes' maps (#164), music (#350) and games: what it was ordered from any
	// other, done now. The maps first: they say whether the device was forgotten. The games after
	// the music, in the same 2 GB.
	// The browser's offer to install comes once, early: kept for any page (InstallApp).
	onMount(() => installApp.watch());

	onMount(() => {
		if (!data.user) return;
		void (async () => {
			const { routeMaps } = await import('comun/route-maps.svelte.ts');
			const { offlineMusic } = await import('#lib/offline-music.svelte.ts');
			const { offlineGames } = await import('#lib/offline-games.svelte.ts');
			// What it already keeps sounds from its disk from the start.
			await offlineMusic.open().catch(() => {});
			await offlineGames.whenOpen().catch(() => {});
			await routeMaps.sync();
			offlineMusic.reserved = offlineGames.bytes;
			await offlineMusic.sync();
			await offlineGames.sync();
		})();
		// The pages that open with no network (offline-pages.ts), for this version.
		void import('#lib/offline-pages.ts').then((p) => p.keepOfflinePages(version)).catch(() => {});
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

	// Which section they went to, for /admin's «Qué usa» (section-visits-scope.ts): after a real
	// navigation, not a link's preload; the same section, said again only after half an hour.
	const told = new Map<string, number>();
	afterNavigate(({ to }) => {
		const section = to?.url && sectionOfPath(to.url.pathname);
		if (!data.user || !section) return;
		const now = Date.now();
		if (now - (told.get(section.path) ?? -Infinity) < 30 * 60_000) return;
		told.set(section.path, now);
		void fetch('/api/visita', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ path: to!.url.pathname }),
			keepalive: true
		}).catch(() => {});
	});

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

<svelte:window
	onkeydown={(e) => {
		voiceKeyDown(e);
		// Escape or Backspace go back, as at home (a PC); not in the road mode nor the Vista's
		// home and recipe, which have their own way out.
		if (!['/carretera', '/vista', '/cocina'].includes(page.url.pathname)) backKey(e);
	}}
	onkeyup={voiceKeyUp}
	onblur={() => voiceKeyUp()}
/>

<svelte:head>
	<title>Seilide</title>
	<!-- From static/, not inlined: some browsers show no icon for a data: URL (the snail, the same file). -->
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png" />
	<meta name="theme-color" content={themeColor(data.theme)} />
	<!-- Their colours (Ajustes), as at home: values only from the themes' table. -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- a <style> made from the themes' own table, never from what was typed. -->
	{@html themeCss(data.theme)}
</svelte:head>

{#if slow}
	<div
		class="pointer-events-none fixed inset-0 z-50 grid place-items-center"
		role="status"
		aria-label="Cargando"
	>
		<div class="rounded-2xl bg-zinc-900/90 p-5 shadow-lg ring-1 ring-zinc-700">
			<Caracol class="w-20 text-emerald-500" />
		</div>
	</div>
{/if}

<!-- The road mode is the whole screen, without the site around it, as at home; and a shared
trip's link (#81), for whoever has it, and a shared walk's (#434), with its own bar. -->
{#if page.url.pathname === '/carretera' || page.url.pathname.startsWith('/s/') || page.url.pathname.startsWith('/p/')}
	{@render children()}
{:else if vistaShown}
	<VistaScreen>{@render children()}</VistaScreen>
{:else}
	<!-- With the chat's panel, the whole page (its bar too) leaves it the room on the right. -->
	<div style:--header-h="{headerHeight}px" class={[chatShown && 'lg:pr-96']}>
		{#if data.user}
			<SiteNav
				bind:headerHeight
				brandOnPhone={!backShown}
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
				{#snippet start()}
					{#if backShown}
						<button
							type="button"
							title="Atrás"
							aria-label="Atrás"
							class="-mr-4 -ml-2 shrink-0 rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
							onclick={() => goBack(() => void goto('/'))}
						>
							<svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
								<path
									d="M15 5l-7 7 7 7"
									fill="none"
									stroke="currentColor"
									stroke-width="2.5"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							</svg>
						</button>
					{/if}
				{/snippet}
				{#snippet leading()}
					<!-- Not for a child (#303): the voice is the grown-ups'. -->
					{#if !data.family?.kid}
						<!-- Close together, as one group of tools: the bar's gap is for the sections. -->
						<div class="-ml-3 flex shrink-0 items-center gap-1">
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
									'shrink-0 touch-none rounded-md p-1 select-none hover:bg-zinc-800 hover:text-white',
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
							<!-- The Vista (#525), one tap away: today in the house, the recipe, the music. -->
							<button
								title="Vista: la pantalla de casa, a pantalla completa"
								aria-label="Vista"
								class={[
									'shrink-0 rounded-md p-1 hover:bg-zinc-800 hover:text-white',
									vista.on ? 'text-amber-400' : 'text-zinc-400'
								]}
								onclick={() => vista.enter(true)}
							>
								<!-- A screen on its stand with a house: the tablet on the wall. -->
								<svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true">
									<rect
										x="2.5"
										y="3.5"
										width="19"
										height="13"
										rx="2"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
									/>
									<path
										d="M8.5 12.5v-3L12 7l3.5 2.5v3M9 20.5h6M12 16.5v4"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</button>
							<!-- «Preguntar» on the right of the page (#504): only where it fits; elsewhere, and on
							     its own page, its section in the bar. -->
							{#if chatOn && page.url.pathname !== '/preguntar'}
								<button
									title={chatShown ? 'Cerrar Preguntar' : 'Preguntar, al lado de esta página'}
									aria-label="Preguntar al lado"
									aria-pressed={chatShown}
									class={[
										'hidden shrink-0 rounded-md p-1 hover:bg-zinc-800 hover:text-white lg:block',
										chatShown ? 'text-amber-400' : 'text-zinc-400'
									]}
									onclick={() => chatPanel.toggle()}
								>
									<SectionIcon name="preguntar" class="h-6 w-6" />
								</button>
							{/if}
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
						</div>
					{/if}
				{/snippet}
				{#snippet below()}
					<div class="mx-auto flex max-w-6xl flex-col gap-1 px-4 has-[>div]:pb-2">
						<!-- What the header's microphone heard and answered; Hablar shows it big itself. -->
						{#if page.url.pathname !== '/voz'}
							<VoiceBubble />
						{/if}
						<!-- The kitchen's timers (#60), counting down; the one that ended, big. -->
						{#if voiceOn}
							<TimerBar />
						{/if}
						<!-- A walk going on (#410), the grown-ups'. -->
						{#if voiceOn && data.user}
							<WalkBar userId={data.user.id} />
						{/if}
						<!-- The trip shared from here (#550), outside the road mode. -->
						<ShareBar />
						<!-- The radio and the podcasts (#253), going on from page to page, as at home. -->
						<MusicBar />
						<!-- The AI's spending (#193), if they asked for it in Ajustes, as at home. -->
						{#if data.spendLine}
							<AiSpendLine />
						{/if}
					</div>
				{/snippet}
			</SiteNav>
			<!-- The family's AI stopped (ai-block.ts), to who runs it: «Ya he recargado». -->
			{#if data.aiBlocked}
				<AiStoppedBanner why={data.aiBlocked.why} />
			{/if}
			<!-- An alarm ringing in the house (#241), with «Parar»: wherever it sounds. -->
			{#if data.family}
				<AlarmBanner />
			{/if}
			<!-- A child asking to enter on the family's device (#303), to its adults. -->
			<!-- Not on the page that answers one by its QR: the same request twice. -->
			{#if data.guardian && !page.url.pathname.startsWith('/peques/')}
				<KidRequests />
			{/if}
		{/if}

		<!-- Room under the page for the call button (#330): its end is never hidden behind it. -->
		<main class={['mx-auto max-w-6xl px-4 py-6', callButtonShown && 'pb-36']}>
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

	{#if chatShown}
		<ChatPanel />
	{:else if chatOn && page.url.pathname !== '/preguntar'}
		<!-- Closed, a tab on the right edge opens it (as the bar's button), where it fits. -->
		<button
			title="Preguntar, al lado de esta página"
			aria-label="Abrir Preguntar al lado"
			class="fixed top-1/2 right-0 z-20 hidden -translate-y-1/2 items-center gap-1 rounded-l-lg border border-r-0 border-zinc-700 bg-zinc-900 px-1.5 py-3 text-xs text-zinc-400 shadow-lg [writing-mode:vertical-rl] hover:bg-zinc-800 hover:text-white lg:flex"
			onclick={() => chatPanel.toggle()}
		>
			<SectionIcon name="preguntar" class="h-5 w-5" />
			Preguntar
		</button>
	{/if}

	{#if callButtonShown && data.callButton}
		<CallButton favorites={data.callButton.favorites} beside={chatShown} />
	{/if}
{/if}
