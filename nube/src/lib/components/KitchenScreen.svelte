<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import AlarmBanner from 'comun/components/AlarmBanner.svelte';
	import MusicBar from 'comun/components/MusicBar.svelte';
	import TimerBar from '#lib/components/TimerBar.svelte';
	import VoicePanel from '#lib/components/VoicePanel.svelte';
	import { kitchenMode } from '#lib/kitchen-mode.svelte.ts';

	/**
	 * The kitchen's screen (#483), for the tablet on the kitchen's wall, lying down: the whole
	 * screen, without the site's bar, as the road mode. On the left (40 %) the steps, the
	 * microphone and the timers, always there; on the right the page that is on, under big tabs:
	 * the recipe (/cocina), the series, the channels, the music, the radio and the podcasts, as they
	 * are in the site. The
	 * right side scrolls with the window, so each page keeps its own scroll and «back» works. On a
	 * narrow screen, one over the other.
	 */
	let { children }: { children: Snippet } = $props();

	const TABS = [
		{ href: '/cocina', label: 'Receta', icon: '🍳', also: '/recetas' },
		{ href: '/series', label: 'Series', icon: '📺', also: '/watch' },
		{ href: '/canales', label: 'Canales', icon: '📡' },
		{ href: '/musica', label: 'Música', icon: '🎵' },
		{ href: '/radio', label: 'Radio', icon: '📻', not: '/radio/podcasts' },
		{ href: '/radio/podcasts', label: 'Podcasts', icon: '🎙️' }
	];
	const current = (t: (typeof TABS)[number]) => {
		const path = page.url.pathname;
		const under = (p?: string) => Boolean(p) && (path === p || path.startsWith(`${p}/`));
		const on = under(t.href) || under(t.also);
		return on && !under(t.not);
	};

	let tabsHeight = $state(0);
</script>

<!-- The left, fixed on a wide screen: what scrolls is the right. Opaque, over a page's background. -->
<aside
	class="border-b border-zinc-800 bg-zinc-950 md:fixed md:inset-y-0 md:left-0 md:z-30 md:w-[40%] md:overflow-y-auto md:border-r md:border-b-0"
	aria-label="Pasos"
>
	<div class="flex flex-col gap-2 px-4 has-[>*]:pt-3">
		<AlarmBanner />
		<TimerBar />
	</div>
	<VoicePanel kitchen />
</aside>

<div class="md:ml-[40%]" style:--header-h="{tabsHeight}px">
	<header
		bind:clientHeight={tabsHeight}
		class="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur"
	>
		<div class="flex items-center gap-2 px-3 py-2">
			<!-- Six, side by side in the 60 %: the icon over its name, all the same width. -->
			<nav class="grid min-w-0 flex-1 grid-cols-6 gap-1.5" aria-label="Cocina">
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
			<!-- Its page in the family's guide (#495), in another tab. -->
			<a
				href="https://docs.seilide.app/guia/recetas/#cocinar"
				target="_blank"
				rel="noopener"
				class="flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
				aria-label="Cómo se usa la cocina (guía)"
				title="Cómo se usa la cocina"
				><span class="text-2xl leading-none" aria-hidden="true">?</span>Ayuda</a
			>
			<button
				class="flex shrink-0 flex-col items-center gap-0.5 rounded-xl px-2 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white"
				aria-label="Salir de la cocina"
				title="Salir de la cocina"
				onclick={() => kitchenMode.leave()}
				><span class="text-2xl leading-none" aria-hidden="true">✕</span>Salir</button
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
