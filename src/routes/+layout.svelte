<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import AiSpendLine from '#lib/components/AiSpendLine.svelte';
	import AlarmBanner from 'comun/components/AlarmBanner.svelte';
	import SalonBar from '#lib/components/SalonBar.svelte';
	import SnapcastBar from '#lib/components/SnapcastBar.svelte';
	import SectionIcon, { type Section } from 'comun/components/SectionIcon.svelte';
	import SiteNav, { type NavLink, type UserLink } from 'comun/components/SiteNav.svelte';
	import { menuItem } from 'comun/components/menu.ts';
	import VoiceBubble from '#lib/components/VoiceBubble.svelte';
	import TimerBar from '#lib/components/TimerBar.svelte';
	import VoicePanel from '#lib/components/VoicePanel.svelte';
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import OpeningQuote from '#lib/components/OpeningQuote.svelte';
	import KidRequests from '#lib/components/KidRequests.svelte';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { kitchenPanel } from '#lib/kitchen-panel.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { tapMic } from '#lib/mic-tap.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { music } from 'comun/music-player.svelte.ts';
	import { page, updated } from '$app/state';
	import { themeColor, themeCss } from 'comun/themes.ts';
	import { avatar } from 'comun/avatars.ts';
	import { onMount, untrack } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	/** The AI's credit banner: «Ya he recargado», and the page again without it. */
	let recharging = $state(false);
	async function recharged() {
		recharging = true;
		await fetch('/api/ia/recargado', { method: 'POST' }).catch(() => {});
		await invalidateAll();
		recharging = false;
	}

	/** The title card when the app opens (Ajustes), once: not over a video opened from a link. */
	let openingQuote = $state(
		untrack(() => (page.url.pathname.startsWith('/watch') ? null : data.openingQuote))
	);

	// After an update (#20), a tab left open (the TV's /tv) still runs the old code: the next
	// navigation loads the whole page, the new version, instead. SvelteKit notices the new version on
	// server responses, when the tab is shown again, and every 5 minutes (vite.config.ts).
	// https://svelte.dev/docs/kit/configuration#version
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});

	/** The header's height, as drawn: what sticks under it starts there. */
	let headerHeight = $state(0);

	// «Hola casita» instead of the microphone (#144), where this device turned it on (Ajustes);
	// not in /activacion, which tries the words with the microphone itself. `want` untracked: it
	// reads its status, and a start that failed (no microphone) set it off and ran it again, loading
	// the models over and over until the page stopped answering (2026-10-26).
	$effect(() => {
		const wanted =
			Boolean(data.voice) && wakeWord.on && !page.url.pathname.startsWith('/activacion');
		untrack(() => wakeWord.want(wanted));
	});
	// Cleaned while nothing plays here: with music or a video, Android's cleaning took the voice too.
	$effect(() => {
		wakeWord.sounding(music.playing || videoHere.playing);
	});

	// A notice touched with the app open (service worker): to its page, without loading it again,
	// so what plays goes on. Only the app's own paths.
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

	/**
	 * A section that lives in the cloud (#253): straight there, as the cloud's bar goes to the house;
	 * without it connected, the house's page for it, which says how (Ajustes → Casa → «La nube»).
	 */
	const inCloud = (path: string, label: string, icon: Section) =>
		data.cloud
			? { href: `${data.cloud}${path}`, label, icon, external: true }
			: { href: path, label, icon };

	const links: NavLink[] = $derived([
		// With Hoy and Listas in its tabs.
		{ href: '/', label: 'Series', icon: 'series', also: ['/series', '/today', '/lists'] },
		...(data.cinema ? [{ href: '/cine', label: 'Cine', icon: 'cine' as const }] : []),
		...(data.music ? [{ href: '/musica', label: 'Música', icon: 'musica' as const }] : []),
		{ href: '/radio', label: 'Radio', icon: 'radio' },
		{ href: '/canales', label: 'Canales', icon: 'canales' },
		// The family's, in the cloud (#253): its recipe book, its post-its and shopping list (#131),
		// its agenda (#200), its expenses (#194) and each one's trips with the road mode (#81). For
		// the adults, who have an account there.
		...(data.kid
			? []
			: [
					inCloud('/recetas', 'Recetas', 'recetas'),
					inCloud('/nevera', 'Nevera', 'nevera'),
					inCloud('/agenda', 'Agenda', 'agenda'),
					inCloud('/gastos', 'Gastos', 'gastos'),
					inCloud('/viajes', 'Viajes', 'viajes')
				]),
		...(data.salon ? [{ href: '/salon', label: 'Salón', icon: 'salon' as const }] : []),
		// What was played (#176): the games themselves are played in the TV view.
		...(data.games ? [{ href: '/juegos', label: 'Juegos', icon: 'juegos' as const }] : []),
		...(data.kidsPage ? [{ href: '/infantil', label: 'Infantil', icon: 'infantil' as const }] : [])
	]);
	/**
	 * Not a section to watch or listen to: in the user's menu on wide screens, last in the phone's.
	 * Not for a child's account: it does not exist for it. With Etiquetas and Registro in its tabs.
	 */
	const gestion = $derived(
		data.kid
			? undefined
			: { href: '/library', label: 'Gestión', icon: 'gestion' as const, also: ['/logs'] }
	);
	const menuLinks = $derived(gestion ? [...links, gestion] : links);
	/** The badge's menu: Ajustes, Gestión, and the living room's TV view (#11, only with mpv). */
	const userLinks: UserLink[] = $derived([
		{ href: '/ajustes', label: 'Ajustes', icon: 'ajustes' },
		...(gestion ? [gestion] : []),
		...(data.salon ? [{ href: '/tv', label: 'Vista TV', icon: 'series' as const }] : [])
	]);

	/**
	 * Held this long, the header's microphone listens; let go sooner, it was a tap: /voz opens. With
	 * taps (Ajustes), the other way round: a tap starts or sends, and held this long /voz opens.
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
			// Held: /voz opened. A tap: it starts, or sends.
			if (holdTimer === undefined) return;
			clearTimeout(holdTimer);
			holdTimer = undefined;
			if (!cancelled) tapMic();
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
		if (!data.voice || !isVoiceKey(e)) return;
		e.preventDefault();
		if (e.repeat || keyHolding) return;
		// With taps (Ajustes): once to start, once more to send.
		if (micMode.tap) return tapMic();
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

	const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`);
	/** The section a page is in: its own address or, for those with tabs, any of theirs. */
	const isCurrent = (href: string) => {
		const path = page.url.pathname;
		const also = menuLinks.find((l) => l.href === href)?.also ?? [];
		return (href === '/' ? path === '/' : under(path, href)) || also.some((h) => under(path, h));
	};

	/** The user's initial, for their round badge (accents and all: «Á» for «Álvaro»). */
	const initial = $derived([...(data.user?.name.trim() ?? '')][0]?.toLocaleUpperCase('es') ?? '?');
	/** Their drawing instead (#157), on its colour. */
	const drawing = $derived(data.user?.avatar ? avatar(data.user.avatar) : null);
	const badge = $derived(
		drawing
			? `${drawing.color} text-lg`
			: 'bg-amber-500 text-sm font-semibold text-zinc-950 hover:bg-amber-400'
	);

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

	/** The kitchen panel (#60): over any page but /voz, which is the same thing. */
	const panelShown = $derived(
		Boolean(data.voice) && kitchenMode.on && kitchenPanel.open && page.url.pathname !== '/voz'
	);
</script>

<svelte:window
	onkeydown={(e) => {
		voiceKeyDown(e);
		if (e.key === 'Escape' && panelShown) return kitchenPanel.hide();
		back(e);
	}}
	onkeyup={voiceKeyUp}
	onblur={() => voiceKeyUp()}
/>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>JellyCartoon</title>
	<meta name="theme-color" content={themeColor(data.theme)} />
	<!-- The account's colours (Ajustes): values only from the themes' table. -->
	{@html themeCss(data.theme)}
</svelte:head>

{#if openingQuote}
	<OpeningQuote quote={openingQuote} ondone={() => (openingQuote = null)} />
{/if}

<!-- A child asking to enter on a device of the house (#141): to its parents, on any page. -->
{#if data.guardian}
	<KidRequests />
{/if}

{#snippet kidAccount({ isCurrent }: { isCurrent: (href: string) => boolean })}
	<!-- A child's account has only Ajustes: the badge goes straight there. -->
	{#if data.salon}
		<a
			href="/tv"
			title="Vista TV"
			aria-label="Vista TV"
			class="mr-3 rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
			><SectionIcon name="series" class="h-6 w-6" /></a
		>
	{/if}
	<a
		href="/ajustes"
		title="{data.user?.name} · Ajustes"
		aria-label="{data.user?.name} · Ajustes"
		class={[
			'flex h-8 w-8 items-center justify-center rounded-full',
			badge,
			isCurrent('/ajustes') && 'ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-950'
		]}>{drawing?.emoji ?? initial}</a
	>
{/snippet}

<!-- The TV view (#11), the road mode (#78) and the children's «¿Quién eres?» (#141) are the whole
     screen, without the site around it. -->
{#if page.url.pathname === '/tv' || page.url.pathname.startsWith('/tv/') || page.url.pathname === '/quien'}
	{@render children()}
{:else}
	<!-- With the kitchen panel at its side (wide screens) or under it (narrow: a phone, or split
	     screen), the page takes the rest: a video in it goes on being seen. -->
	<!-- --header-h: how high the bar is on this screen, for what sticks under it (Ajustes, #178). -->
	<div class={[panelShown && 'pb-[55dvh] md:pr-[42%] md:pb-0']} style:--header-h="{headerHeight}px">
		{#if data.user}
			<SiteNav
				bind:headerHeight
				brand={{ href: '/', title: 'JellyCartoon', image: favicon }}
				{links}
				{menuLinks}
				user={{ name: data.user.name, badge, mark: drawing?.emoji ?? initial }}
				{userLinks}
				canLeave={!data.kid}
				account={data.kid ? kidAccount : undefined}
			>
				{#snippet leading()}
					{#if data.voice}
						<a
							href="/voz"
							title={micMode.auto
								? 'Toca para hablar: se envía al callarte (o Ctrl+Mayús+Espacio) · Mantén pulsado para abrir Hablar'
								: micMode.tap
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
					{/if}
				{/snippet}
				{#snippet below()}
					<div class="mx-auto flex max-w-6xl flex-col gap-1 px-4 has-[>div]:pb-2">
						<!-- What the header's microphone heard and answered; /voz shows it big itself. -->
						{#if data.voice && page.url.pathname !== '/voz' && !panelShown}
							<VoiceBubble />
						{/if}
						<!-- Kitchen timers set by voice, counting down; the one that ended, big. -->
						{#if data.voice}
							<TimerBar />
						{/if}
						<!-- Everywhere but its remote. -->
						{#if data.salon && !isCurrent('/salon')}
							<SalonBar />
						{/if}
						{#if data.snapcast}
							<SnapcastBar />
						{/if}
						<!-- Music, and the radio. -->
						<MusicBar />
						<!-- The month's AI spending (#193), if this adult asked for it in Ajustes. -->
						{#if data.spendLine}
							<AiSpendLine />
						{/if}
					</div>
				{/snippet}
			</SiteNav>
			<!-- An alarm or a timer ringing (#241), with «Parar»: wherever it sounds. -->
			{#if data.user}
				<AlarmBanner />
			{/if}
			{#if data.newVersion && !isCurrent('/ajustes')}
				<a
					href="/ajustes?seccion=casa#version"
					class="block border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-300 hover:bg-amber-500/20"
					>Hay una versión nueva de JellyCartoon, la {data.newVersion}. Ver novedades y actualizar →</a
				>
			{/if}
			{#if data.aiCreditOut}
				<!-- Nothing goes to the AI until then (openrouter.ts): voice, the DJ, receipts… -->
				<div
					class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-center text-sm text-red-300"
					role="alert"
				>
					<span>
						Se acabó el crédito de la IA: no funcionan la voz, el DJ, los tickets… Recárgalo en
						<a
							href="https://openrouter.ai/settings/credits"
							class="underline"
							target="_blank"
							rel="noreferrer">openrouter.ai</a
						>.
					</span>
					<button
						class="rounded-md bg-red-500/20 px-3 py-1 text-red-100 hover:bg-red-500/30 disabled:opacity-50"
						disabled={recharging}
						onclick={recharged}>Ya he recargado</button
					>
				</div>
			{/if}
		{/if}

		<!-- overflow-x-clip: the "cinema" player is 100vw wide, which includes the scrollbar.
		     relative: a page's backdrop (Backdrop.svelte) starts under the bar, not behind it. -->
		<main class="relative mx-auto max-w-6xl overflow-x-clip px-4 py-6">
			{@render children()}
		</main>
	</div>

	{#if panelShown}
		<!-- Over the page, which stays as it is: what plays in it goes on. Its lower half on a narrow
		     window (a phone, or split screen); a side on a tablet lying down or a computer. -->
		<aside
			class="fixed inset-x-0 bottom-0 z-30 h-[55dvh] overflow-y-auto border-t border-zinc-800 bg-zinc-950 md:top-0 md:left-auto md:h-auto md:w-[42%] md:border-t-0 md:border-l"
			aria-label="Cocina"
		>
			<div
				class="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-zinc-950/95 px-4 py-2 backdrop-blur"
			>
				<span class="shrink-0 font-semibold text-amber-300">🍳 Cocina</span>
				{#if videoHere.current}
					<!-- The video under it: paused or on with a tap, without going back to it. -->
					<button
						class="flex min-w-0 items-center gap-2 rounded-full bg-zinc-800 py-1 pr-3 pl-1 text-sm hover:bg-zinc-700"
						aria-label="{videoHere.playing ? 'Pausar' : 'Seguir'}: {videoHere.current.title}"
						onclick={() => videoHere.toggle()}
					>
						<span
							class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-zinc-950"
							><MediaIcon name={videoHere.playing ? 'pause' : 'play'} class="h-4 w-4" /></span
						>
						<span class="truncate">{videoHere.current.title}</span>
					</button>
				{/if}
				<button
					class="ml-auto shrink-0 rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
					onclick={() => kitchenPanel.hide()}
					>{videoHere.current ? 'Volver al vídeo' : 'Cerrar'}</button
				>
			</div>
			<VoicePanel inPanel />
		</aside>
	{/if}
{/if}
