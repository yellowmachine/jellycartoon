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
	 * the recipe (/cocina), the music, the radio and the podcasts, as they are in the site. The
	 * right side scrolls with the window, so each page keeps its own scroll and «back» works. On a
	 * narrow screen, one over the other.
	 */
	let { children }: { children: Snippet } = $props();

	const TABS = [
		{ href: '/cocina', label: 'Receta', icon: '🍳', also: '/recetas' },
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
			<nav class="flex min-w-0 flex-1 gap-2 overflow-x-auto" aria-label="Cocina">
				{#each TABS as t (t.href)}
					<a
						href={t.href}
						aria-current={current(t) ? 'page' : undefined}
						class={[
							'flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-lg font-semibold transition active:scale-95',
							current(t)
								? 'bg-amber-500 text-zinc-950'
								: 'bg-zinc-900 text-zinc-200 hover:bg-zinc-800'
						]}><span aria-hidden="true">{t.icon}</span>{t.label}</a
					>
				{/each}
			</nav>
			<button
				class="shrink-0 rounded-xl px-4 py-3 text-base text-zinc-300 hover:bg-zinc-800"
				onclick={() => kitchenMode.leave()}>Salir de la cocina</button
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
