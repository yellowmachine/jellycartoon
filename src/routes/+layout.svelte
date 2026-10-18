<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import MusicBar from '#lib/components/MusicBar.svelte';
	import SalonBar from '#lib/components/SalonBar.svelte';
	import SnapcastBar from '#lib/components/SnapcastBar.svelte';
	import SectionIcon, { type Section } from '#lib/components/SectionIcon.svelte';
	import VoiceBubble from '#lib/components/VoiceBubble.svelte';
	import { beforeNavigate, goto } from '$app/navigation';
	import { voice } from '#lib/voice-client.svelte.ts';
	import { page, updated } from '$app/state';
	import { themeColor, themeCss } from '#lib/themes.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// After an update (#20), a tab left open (the TV's /tv) still runs the old code: the next
	// navigation loads the whole page, the new version, instead. SvelteKit notices the new version on
	// server responses, when the tab is shown again, and every hour.
	// https://svelte.dev/docs/kit/configuration#version
	beforeNavigate(({ willUnload, to }) => {
		if (updated.current && !willUnload && to?.url) location.href = to.url.href;
	});

	const links: { href: string; label: string; icon: Section; also?: string[] }[] = $derived([
		// With Hoy and Listas in its tabs.
		{ href: '/', label: 'Series', icon: 'series', also: ['/series', '/today', '/lists'] },
		...(data.cinema ? [{ href: '/cine', label: 'Cine', icon: 'cine' as const }] : []),
		...(data.music ? [{ href: '/musica', label: 'Música', icon: 'musica' as const }] : []),
		{ href: '/radio', label: 'Radio', icon: 'radio' },
		{ href: '/canales', label: 'Canales', icon: 'canales' },
		...(data.salon ? [{ href: '/salon', label: 'Salón', icon: 'salon' as const }] : []),
		...(data.kidsPage ? [{ href: '/infantil', label: 'Infantil', icon: 'infantil' as const }] : []),
		// Not for a child's account: they do not exist for it.
		...(data.kid
			? []
			: // With Etiquetas and Registro in its tabs.
				[{ href: '/library', label: 'Gestión', icon: 'gestion' as const, also: ['/logs'] }])
	]);

	/** Held this long, the header's microphone listens; let go sooner, it was a tap: /voz opens. */
	const HOLD_MS = 250;
	/** Pressed, and not yet long enough to listen: a tap so far. */
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	/** Listening: let go, and what was said is sent. */
	let holding = false;

	/** A tap does not wake the microphone (nor ask for its permission): only holding it does. */
	function pressMic() {
		clearTimeout(holdTimer);
		holdTimer = setTimeout(() => {
			holdTimer = undefined;
			holding = true;
			void voice.start();
		}, HOLD_MS);
	}

	function releaseMic(cancelled: boolean) {
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

<svelte:window
	onkeydown={(e) => {
		voiceKeyDown(e);
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
				<!-- Voice commands (#33): a microphone by the name, on every screen, phones too. Held down,
				     it listens without leaving the page (an episode playing pauses); tapped, it opens /voz. -->
				{#if data.voice}
					<a
						href="/voz"
						title="Mantén pulsado para hablar (o Ctrl+Mayús+Espacio) · Pulsa para abrir Hablar"
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
				<!-- Wide screens: every link in a row; with its icon from xl, as with every section both do
				     not fit in 1024px. -->
				{#each links as link (link.href)}
					<a
						href={link.href}
						class={[
							'hidden items-center gap-1.5 text-sm hover:text-white lg:inline-flex',
							isCurrent(link.href) ? 'text-white' : 'text-zinc-400'
						]}
						><SectionIcon
							name={link.icon}
							class="hidden h-[18px] w-[18px] shrink-0 xl:block"
						/>{link.label}</a
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
							><SectionIcon name="series" class="h-6 w-6" /></a
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
					<!-- Not for a child's account: out by mistake, they cannot get back in. An adult switching
					     accounts on that device has it at the end of Ajustes. -->
					{#if !data.kid}
						<button class="text-sm text-zinc-400 hover:text-white">Salir</button>
					{/if}
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
									'flex items-center gap-3 py-3 text-base',
									isCurrent(link.href) ? 'text-amber-400' : 'text-zinc-200'
								]}><SectionIcon name={link.icon} class="h-6 w-6 shrink-0" />{link.label}</a
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
					{#if !data.kid}
						<button class="rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900">
							Salir
						</button>
					{/if}
				</form>
			</div>
			<!-- In the sticky header, under the menu: what is on stays in view on every page. Only with
		     a bar showing does it take room (MusicBar's <audio> is always there, but not a div). -->
			<div class="mx-auto flex max-w-6xl flex-col gap-1 px-4 has-[>div]:pb-2">
				<!-- What the header's microphone heard and answered; /voz shows it big itself. -->
				{#if data.voice && page.url.pathname !== '/voz'}
					<VoiceBubble />
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

	<!-- overflow-x-clip: the "cinema" player is 100vw wide, which includes the scrollbar. -->
	<main class="mx-auto max-w-6xl overflow-x-clip px-4 py-6">
		{@render children()}
	</main>
{/if}
