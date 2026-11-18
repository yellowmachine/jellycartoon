<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import { page } from '$app/state';
	import { music } from 'comun/music-player.svelte.ts';
	import AlarmBanner from 'comun/components/AlarmBanner.svelte';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import TimerBar from '#lib/components/TimerBar.svelte';
	import VistaRest from '#lib/components/VistaRest.svelte';
	import VoicePanel from '#lib/components/VoicePanel.svelte';
	import { vista } from '#lib/vista.svelte.ts';

	/**
	 * The Vista's screen (#525, what was the kitchen's, #483), for the tablet on the wall, lying
	 * down: the whole screen, without the site's bar, as the road mode. On the left (40 %) the
	 * microphone, the timers and the steps while cooking, always there; on the right the page that
	 * is on, under big tabs: today in the house (/vista), the recipe (/cocina), the series, the
	 * channels, the music («Sonando», big, while something plays), the radio and the podcasts, as
	 * they are in the site. The right side scrolls with the window, so each page keeps its own
	 * scroll and «back» works. The tabs always at the top; on a narrow screen, the page first and
	 * the left under it. Untouched a while, it rests (VistaRest.svelte).
	 */
	let { children }: { children: Snippet } = $props();

	/** A song or an episode on (not the radio, which has its own tab): Música opens «Sonando». */
	const playing = $derived(Boolean((music.radio ? null : music.current) ?? music.podcast));
	type Tab = { href: string; label: string; icon: string; also?: string; not?: string };
	const TABS: Tab[] = $derived([
		{ href: '/vista', label: 'Inicio', icon: '🏠', not: '/vista/sonando' },
		{ href: '/cocina', label: 'Receta', icon: '🍳', also: '/recetas' },
		{ href: '/series', label: 'Series', icon: '📺', also: '/watch' },
		{ href: '/canales', label: 'Canales', icon: '📡' },
		playing
			? { href: '/vista/sonando', label: 'Música', icon: '🎵', also: '/musica' }
			: { href: '/musica', label: 'Música', icon: '🎵', also: '/vista/sonando' },
		{ href: '/radio', label: 'Radio', icon: '📻', not: '/radio/podcasts' },
		{ href: '/radio/podcasts', label: 'Podcasts', icon: '🎙️' }
	]);
	const current = (t: Tab) => {
		const path = page.url.pathname;
		const under = (p?: string) => Boolean(p) && (path === p || path.startsWith(`${p}/`));
		const on = under(t.href) || under(t.also);
		return on && !under(t.not);
	};

	let tabsHeight = $state(0);

	/**
	 * Locked (#532): «Salir» held down this long, and then let go; let go before, nothing. It leaves
	 * on letting go, not when the ring fills: with the finger still down, the page under it once out
	 * (the site's bar, with its «Vista» button in the same corner) would take the touch and go back.
	 */
	const HOLD_MS = 3000;
	let holding = $state(false);
	let held = $state(false);
	let holdTimer: ReturnType<typeof setTimeout> | undefined;
	function holdStart() {
		if (!vista.locked) return;
		holding = true;
		held = false;
		holdTimer = setTimeout(() => {
			held = true;
			navigator.vibrate?.(60);
		}, HOLD_MS);
	}
	function holdEnd(letGo: boolean) {
		clearTimeout(holdTimer);
		const leave = letGo && held;
		holding = false;
		held = false;
		if (leave) void vista.leave();
	}
	/**
	 * Android's own long press (a menu, selecting, the tap after it) would take the touch from the
	 * hold: stopped at the touch itself. Not passive, which Svelte's ontouchstart is; the pointer
	 * events still come, and they do the hold.
	 */
	const noLongPress: Attachment<HTMLElement> = (el) => {
		const stop = (e: TouchEvent) => {
			if (vista.locked && e.cancelable) e.preventDefault();
		};
		const types = ['touchstart', 'touchmove', 'touchend'] as const;
		for (const type of types) el.addEventListener(type, stop, { passive: false });
		return () => {
			for (const type of types) el.removeEventListener(type, stop);
		};
	};
</script>

<!-- The left, fixed on a wide screen: what scrolls is the right. Opaque, over a page's background.
     On a narrow screen it goes after the page, which starts right under the tabs. -->
<div class="flex flex-col md:block" style:--vista-tabs="{tabsHeight}px">
	<aside
		class="order-last border-t border-zinc-800 bg-zinc-950 md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-[40%] md:overflow-y-auto md:border-t-0 md:border-r"
		aria-label="Pasos"
	>
		<div class="flex flex-col gap-2 px-4 has-[>*]:pt-3">
			<AlarmBanner />
			<TimerBar />
		</div>
		<VoicePanel kitchen />
	</aside>

	<!-- The tabs, always at the top of the screen (on a wide one, over the right 60 %). -->
	<div class="pt-[var(--vista-tabs)] md:ml-[40%]" style:--header-h="{tabsHeight}px">
		<header
			bind:clientHeight={tabsHeight}
			class="fixed inset-x-0 top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur md:left-[40%]"
		>
			<div class="flex items-center gap-2 px-3 py-2">
				<!-- Seven, side by side in the 60 %: the icon over its name, all the same width. -->
				<nav class="grid min-w-0 flex-1 grid-cols-7 gap-1.5" aria-label="Vista">
					{#each TABS as t (t.href)}
						<a
							href={t.href}
							aria-current={current(t) ? 'page' : undefined}
							class={[
								'flex min-w-0 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-base font-semibold transition active:scale-95',
								current(t)
									? 'bg-amber-500 text-zinc-950'
									: 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
							]}
							><span class="text-2xl leading-none" aria-hidden="true">{t.icon}</span><span
								class="max-w-full truncate">{t.label}</span
							></a
						>
					{/each}
				</nav>
				<!-- Its page in the family's guide (#495), in another tab; locked (#532), not: it leaves. -->
				{#if !vista.locked}<a
						href="https://docs.seilide.app/guia/vista/"
						target="_blank"
						rel="noopener"
						class="flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
						aria-label="Cómo se usa la Vista (guía)"
						title="Cómo se usa la Vista"
						><span class="text-2xl leading-none" aria-hidden="true">?</span>Ayuda</a
					>{/if}
				<!-- Locked (#532): held down 3 s, with a ring that fills; a tap alone does nothing. -->
				<button
					class="relative flex shrink-0 touch-none flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-sm text-zinc-400 select-none [-webkit-touch-callout:none] hover:bg-zinc-800 hover:text-white"
					aria-label={vista.locked ? 'Salir de la Vista: mantén pulsado' : 'Salir de la Vista'}
					title={vista.locked ? undefined : 'Salir de la Vista: la web de siempre'}
					onclick={() => vista.locked || vista.leave()}
					{@attach noLongPress}
					onpointerdown={holdStart}
					onpointerup={() => holdEnd(true)}
					onpointerleave={() => holdEnd(false)}
					onpointercancel={() => holdEnd(false)}
					oncontextmenu={(e) => e.preventDefault()}
					><span class="relative text-2xl leading-none" aria-hidden="true"
						>✕{#if holding}<svg
								class="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] -rotate-90"
								viewBox="0 0 36 36"
								><circle
									class="fill"
									cx="18"
									cy="18"
									r="16"
									fill="none"
									stroke="currentColor"
									stroke-width="3"
									pathLength="100"
									style:animation-duration="{HOLD_MS}ms"
								/></svg
							>{/if}</span
					>{held ? 'Suelta' : holding ? 'Mantén…' : 'Salir'}</button
				>
			</div>
			<!-- What plays, from one tab to another. -->
			<div class="px-3 has-[>*]:pb-2">
				<MusicBar />
			</div>
		</header>

		<main class="px-4 py-6">
			{@render children()}
		</main>
	</div>
</div>

<VistaRest />

<style>
	/* «Salir» held down (#532): the ring fills in HOLD_MS. */
	.fill {
		stroke-dasharray: 100;
		stroke-dashoffset: 100;
		animation: fill linear forwards;
		color: var(--color-amber-400);
	}
	@keyframes fill {
		to {
			stroke-dashoffset: 0;
		}
	}
</style>
