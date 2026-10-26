<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import AiSpendLine from '#lib/components/AiSpendLine.svelte';
	import SalonBar from '#lib/components/SalonBar.svelte';
	import SnapcastBar from '#lib/components/SnapcastBar.svelte';
	import SectionIcon, { type Section } from '#lib/components/SectionIcon.svelte';
	import ActionMenu from '#lib/components/ActionMenu.svelte';
	import { menuItem } from '#lib/components/menu.ts';
	import VoiceBubble from '#lib/components/VoiceBubble.svelte';
	import TimerBar from '#lib/components/TimerBar.svelte';
	import VoicePanel from '#lib/components/VoicePanel.svelte';
	import MediaIcon from '#lib/components/MediaIcon.svelte';
	import OpeningQuote from '#lib/components/OpeningQuote.svelte';
	import KidRequests from '#lib/components/KidRequests.svelte';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';
	import { kitchenPanel } from '#lib/kitchen-panel.svelte.ts';
	import { videoHere } from '#lib/video-here.svelte.ts';
	import { beforeNavigate, goto } from '$app/navigation';
	import { micMode } from '#lib/mic-mode.svelte.ts';
	import { tapMic } from '#lib/mic-tap.ts';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import { music } from '#lib/music-player.svelte.ts';
	import { pendingReceipt } from '#lib/pending-receipt.svelte.ts';
	import { page, updated } from '$app/state';
	import { themeColor, themeCss } from '#lib/themes.ts';
	import { avatar } from '#lib/avatars.ts';
	import { onMount, untrack } from 'svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	/** The title card when the app opens (Ajustes), once: not over a video opened from a link. */
	let openingQuote = $state(
		untrack(() => (page.url.pathname.startsWith('/watch') ? null : data.openingQuote))
	);

	// After an update (#20), a tab left open (the TV's /tv) still runs the old code: the next
	// navigation loads the whole page, the new version, instead. SvelteKit notices the new version on
	// server responses, when the tab is shown again, and every hour.
	// https://svelte.dev/docs/kit/configuration#version
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});

	/** The header's height, as drawn: what sticks under it starts there. */
	let headerHeight = $state(0);

	// «Hola casita» instead of the microphone (#144), where this device turned it on (Ajustes);
	// not in /activacion, which tries the words with the microphone itself.
	$effect(() => {
		wakeWord.want(
			Boolean(data.voice) && wakeWord.on && !page.url.pathname.startsWith('/activacion')
		);
	});
	// Cleaned while nothing plays here: with music or a video, Android's cleaning took the voice too.
	$effect(() => {
		wakeWord.sounding(music.playing || videoHere.playing);
	});

	// A device that keeps routes' maps (#164): what it was ordered from any other, done now.
	onMount(() => {
		void import('#lib/route-maps.svelte.ts').then(({ routeMaps }) => routeMaps.sync());
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

	const links: { href: string; label: string; icon: Section; also?: string[] }[] = $derived([
		// With Hoy and Listas in its tabs.
		{ href: '/', label: 'Series', icon: 'series', also: ['/series', '/today', '/lists'] },
		...(data.cinema ? [{ href: '/cine', label: 'Cine', icon: 'cine' as const }] : []),
		...(data.music ? [{ href: '/musica', label: 'Música', icon: 'musica' as const }] : []),
		{ href: '/radio', label: 'Radio', icon: 'radio' },
		{ href: '/canales', label: 'Canales', icon: 'canales' },
		// The cartoons of the Dailymotion accounts the adults chose (#66).
		...(data.dailymotion
			? [{ href: '/dailymotion', label: 'Dailymotion', icon: 'dailymotion' as const }]
			: []),
		// The house's recipe book: not for a child's account.
		...(data.kid ? [] : [{ href: '/recetas', label: 'Recetas', icon: 'recetas' as const }]),
		// The house's post-its and shopping list (#131): the adults write on it; the TV shows it.
		...(data.kid ? [] : [{ href: '/nevera', label: 'Nevera', icon: 'nevera' as const }]),
		// The house's agenda (#200): a child sees what is for them.
		{ href: '/agenda', label: 'Agenda', icon: 'agenda' },
		// The house's expenses (#194): its adults', all of them.
		...(data.kid ? [] : [{ href: '/gastos', label: 'Gastos', icon: 'gastos' as const }]),
		// The road mode's trips, and the way into it: not for a child's account, as Modo carretera.
		...(data.kid ? [] : [{ href: '/viajes', label: 'Viajes', icon: 'viajes' as const }]),
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
	/** The user's menu: a row with its icon, drawn as the sections' (Lucide's sliders and log-out). */
	const userItem =
		'flex w-full items-center gap-2.5 rounded px-3 py-1.5 text-left hover:bg-zinc-800';
	const iconSvg = {
		viewBox: '0 0 24 24',
		fill: 'none',
		stroke: 'currentColor',
		'stroke-width': 1.5,
		'stroke-linecap': 'round',
		'stroke-linejoin': 'round',
		class: 'h-[18px] w-[18px] shrink-0',
		'aria-hidden': 'true'
	} as const;

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
	const current = $derived(menuLinks.find((l) => l.href !== '/' && isCurrent(l.href)));

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

	/** The phone menu; closed when one of its links is followed. */
	let menu = $state<HTMLElement>();
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

<!-- The TV view (#11), the road mode (#78) and the children's «¿Quién eres?» (#141) are the whole
     screen, without the site around it. -->
{#if page.url.pathname === '/tv' || page.url.pathname.startsWith('/tv/') || page.url.pathname === '/carretera' || page.url.pathname === '/quien'}
	{@render children()}
{:else}
	<!-- With the kitchen panel at its side (wide screens) or under it (narrow: a phone, or split
	     screen), the page takes the rest: a video in it goes on being seen. -->
	<!-- --header-h: how high the bar is on this screen, for what sticks under it (Ajustes, #178). -->
	<div class={[panelShown && 'pb-[55dvh] md:pr-[42%] md:pb-0']} style:--header-h="{headerHeight}px">
		{#if data.user}
			<header
				bind:offsetHeight={headerHeight}
				class="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/90 backdrop-blur"
			>
				<nav
					class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 md:max-lg:gap-3 md:max-lg:py-2"
				>
					<!-- On a tablet, only the picture: the sections need the room. -->
					<a
						href="/"
						title="JellyCartoon"
						class="flex shrink-0 items-center gap-2 text-lg font-bold text-amber-400"
					>
						<img src={favicon} alt="" class="h-7 w-7 rounded-md" />
						<span class="md:max-lg:sr-only">JellyCartoon</span>
					</a>
					<!-- Voice commands (#33): a microphone by the name, on every screen, phones too. Held down,
				     it listens without leaving the page (an episode playing pauses); tapped, it opens /voz. -->
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
					<!-- A receipt's photo for Gastos (#194), at once: on phones and tablets, with their camera; a
				     PC has the button in Gastos. The photo is read there. -->
					{#if data.receipts}
						<label
							title="Foto de un ticket, para Gastos"
							aria-label="Foto de un ticket"
							class={[
								'hidden shrink-0 cursor-pointer rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white pointer-coarse:block',
								data.voice ? '-ml-5 md:max-lg:-ml-2' : '-ml-3'
							]}
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
					<!-- Wide screens: every link in a row; with its icon from xl, as with every section both do
				     not fit in 1024px. A tablet (md, up to lg): every link too, its icon over a small
				     name, as a tab bar; the one you are in, in amber. -->
					{#each links as link (link.href)}
						<a
							href={link.href}
							class={[
								'hidden items-center gap-1.5 text-sm hover:text-white lg:inline-flex',
								'md:max-lg:flex md:max-lg:min-w-0 md:max-lg:flex-1 md:max-lg:flex-col md:max-lg:gap-0.5 md:max-lg:text-[11px]',
								isCurrent(link.href) ? 'text-white md:max-lg:text-amber-400' : 'text-zinc-400'
							]}
							><SectionIcon
								name={link.icon}
								class="hidden h-[18px] w-[18px] shrink-0 md:max-lg:block md:max-lg:h-6 md:max-lg:w-6 xl:block"
							/><span class="max-w-full truncate">{link.label}</span></a
						>
					{/each}
					<div class="ml-auto hidden items-center md:flex">
						<!-- A child's account has only Ajustes: the badge goes straight there. -->
						{#if data.kid}
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
								title="{data.user.name} · Ajustes"
								aria-label="{data.user.name} · Ajustes"
								class={[
									'flex h-8 w-8 items-center justify-center rounded-full',
									badge,
									isCurrent('/ajustes') &&
										'ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-950'
								]}>{drawing?.emoji ?? initial}</a
							>
						{:else}
							<!-- The user's menu: what is not a section to watch or listen to. -->
							<ActionMenu
								id="user-menu"
								plain
								label="{data.user.name} · Menú"
								width="w-max min-w-40 max-w-64"
							>
								{#snippet icon()}
									<span
										class={[
											'flex h-8 w-8 items-center justify-center rounded-full',
											badge,
											(isCurrent('/ajustes') || (gestion && isCurrent(gestion.href))) &&
												'ring-2 ring-amber-300 ring-offset-2 ring-offset-zinc-950'
										]}>{drawing?.emoji ?? initial}</span
									>
								{/snippet}
								{#snippet children(close)}
									<p class="truncate px-3 py-1.5 text-xs text-zinc-400">{data.user?.name}</p>
									<a href="/ajustes" onclick={close} class={userItem}
										><svg {...iconSvg}
											><path
												d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4"
											/></svg
										>Ajustes</a
									>
									{#if gestion}
										<a href={gestion.href} onclick={close} class={userItem}
											><SectionIcon
												name={gestion.icon}
												class="h-[18px] w-[18px] shrink-0"
											/>{gestion.label}</a
										>
									{/if}
									<!-- The view for the living room's TV and its remote (#11): only with mpv, as Salón. -->
									{#if data.salon}
										<a href="/tv" onclick={close} class={userItem}
											><SectionIcon name="series" class="h-[18px] w-[18px] shrink-0" />Vista TV</a
										>
									{/if}
									<hr class="my-1 border-zinc-800" />
									<!-- Not for a child's account: out by mistake, they cannot get back in. An adult
									     switching accounts on that device has it at the end of Ajustes. -->
									<form method="post" action="/logout">
										<button class={userItem}
											><svg {...iconSvg}
												><path
													d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
												/></svg
											>Salir</button
										>
									</form>
								{/snippet}
							</ActionMenu>
						{/if}
					</div>

					<!-- Phone: the section you are in and a menu with the rest. -->
					{#if current}
						<span class="-ml-3 truncate text-sm text-zinc-300 md:hidden">{current.label}</span>
					{/if}
					<button
						class="ml-auto rounded-md px-2 py-1 text-xl text-zinc-300 hover:bg-zinc-800 md:hidden"
						aria-label="Menú"
						popovertarget="site-menu">☰</button
					>
				</nav>
				<div
					bind:this={menu}
					id="site-menu"
					popover="auto"
					class="inset-x-0 top-14 bottom-auto m-0 max-h-[calc(100dvh-3.5rem)] w-auto overflow-y-auto overscroll-contain border-b border-zinc-800 bg-zinc-950 px-4 pt-2 pb-4 text-zinc-100 shadow-lg md:hidden"
				>
					<!-- Two columns: every section in view at once; scrolled only if even so it does not fit
					     (a phone on its side). -->
					<ul class="grid grid-cols-2 gap-x-2">
						{#each menuLinks as link (link.href)}
							<li>
								<a
									href={link.href}
									onclick={() => menu?.hidePopover()}
									class={[
										'flex min-w-0 items-center gap-3 rounded-md px-2 py-3 text-base hover:bg-zinc-900',
										isCurrent(link.href) ? 'text-amber-400' : 'text-zinc-200'
									]}
									><SectionIcon name={link.icon} class="h-6 w-6 shrink-0" /><span class="truncate"
										>{link.label}</span
									></a
								>
							</li>
						{/each}
					</ul>
					<form
						method="post"
						action="/logout"
						class="mt-2 flex items-center justify-between border-t border-zinc-800 pt-2"
					>
						<a
							href="/ajustes"
							onclick={() => menu?.hidePopover()}
							class="flex items-center gap-2 py-2 text-sm text-zinc-300 hover:text-white"
						>
							<span
								class="flex h-8 w-8 items-center justify-center rounded-full {badge}"
								aria-hidden="true">{drawing?.emoji ?? initial}</span
							>
							{data.user.name} · Ajustes
						</a>
						{#if !data.kid}
							<button
								class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
							>
								Salir
							</button>
						{/if}
					</form>
				</div>
				<!-- In the sticky header, under the menu: what is on stays in view on every page. Only with
		     a bar showing does it take room (MusicBar's <audio> is always there, but not a div). -->
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
			</header>
			{#if data.newVersion && !isCurrent('/ajustes')}
				<a
					href="/ajustes?seccion=casa#version"
					class="block border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-300 hover:bg-amber-500/20"
					>Hay una versión nueva de JellyCartoon, la {data.newVersion}. Ver novedades y actualizar →</a
				>
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
