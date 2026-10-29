<script lang="ts" generics="Tab extends string, Shown">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { searchSettings, type SettingsEntry } from '../settings-search.ts';

	/**
	 * «Buscar en Ajustes», above its tabs, in the house and in the cloud (#253): a word, and the
	 * sections that have it in any tab (each app's `index`); one chosen, its tab opens on it, lit for
	 * a moment. With `ask` (an app's endpoint, Seilide's), «Preguntar a la IA» for what the words do
	 * not find: what was written, and back the sections that do it and why.
	 */
	let {
		index,
		labels,
		shown,
		placeholder = 'Buscar en Ajustes: subtítulos, niños, clave…',
		ask
	}: {
		index: SettingsEntry<Tab, Shown>[];
		labels: Record<Tab, string>;
		shown: Shown;
		placeholder?: string;
		ask?: string;
	} = $props();

	/** Frames to wait, at most, for the layout to measure its bar. */
	const MEASURE_FRAMES = 30;

	/**
	 * Opened with a section's #id («/ajustes?seccion=casa#nube»): the browser went to it before the
	 * layout had measured its bar (--header-h, 0 from the server), so it stays under it. Once
	 * measured, to it again.
	 */
	onMount(() => {
		const el = location.hash
			? document.getElementById(decodeURIComponent(location.hash.slice(1)))
			: null;
		if (!el) return;
		let frames = 0;
		let raf = 0;
		const again = () => {
			const measured = parseFloat(getComputedStyle(el).getPropertyValue('--header-h')) > 0;
			if (measured || ++frames >= MEASURE_FRAMES) el.scrollIntoView({ block: 'start' });
			else raf = requestAnimationFrame(again);
		};
		raf = requestAnimationFrame(again);
		return () => cancelAnimationFrame(raf);
	});

	let query = $state('');
	const found = $derived(searchSettings(index, labels, query, shown));

	/** The AI's answer to what is written now; asking, or why it could not. */
	let answer = $state<{ question: string; ids: string[]; why: string } | null>(null);
	let asking = $state(false);
	let problem = $state<string | null>(null);
	const answered = $derived(
		answer && answer.question === query.trim()
			? answer.ids.flatMap((id) => index.filter((e) => e.id === id))
			: null
	);

	async function askAi() {
		const question = query.trim();
		if (!ask || !question || asking) return;
		asking = true;
		problem = null;
		const res = await fetch(ask, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ question })
		}).catch(() => null);
		const body = await res?.json().catch(() => null);
		asking = false;
		if (!res?.ok) return void (problem = body?.message ?? 'Sin conexión');
		answer = { question, ids: body.ids ?? [], why: body.why ?? '' };
	}

	const href = (e: SettingsEntry<Tab, Shown>) => `?seccion=${e.tab}#${e.id}`;

	async function open(e: SettingsEntry<Tab, Shown>) {
		query = '';
		answer = null;
		await goto(href(e), { reset: false });
		const el = document.getElementById(e.id);
		if (!el) return;
		el.scrollIntoView({ behavior: 'smooth', block: 'start' });
		// Again from the start if it was lit already.
		el.classList.remove('settings-found');
		void el.offsetWidth;
		el.classList.add('settings-found');
	}
</script>

{#snippet entry(e: SettingsEntry<Tab, Shown>)}
	<li>
		<a
			href={href(e)}
			class="flex items-baseline gap-2 px-3 py-2 text-sm hover:bg-zinc-900"
			onclick={(ev) => {
				ev.preventDefault();
				void open(e);
			}}
		>
			<span class="text-zinc-500">{labels[e.tab]} ›</span>
			<span>{e.title}</span>
		</a>
	</li>
{/snippet}

<div class="relative mb-4">
	<input
		bind:value={query}
		type="search"
		autocomplete="off"
		{placeholder}
		aria-label="Buscar en Ajustes"
		class="w-full rounded-md border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm"
		onkeydown={(e) => {
			if (e.key === 'Escape') query = '';
			if (e.key !== 'Enter') return;
			e.preventDefault();
			// What the AI found, first; else the words'; else, to the AI.
			const first = answered?.[0] ?? found[0];
			if (first) void open(first);
			else void askAi();
		}}
	/>
	{#if query.trim()}
		<ul
			class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl"
		>
			{#if answered}
				{#if answer?.why}
					<li class="px-3 pt-2 pb-1 text-sm text-amber-300">✨ {answer.why}</li>
				{/if}
				{#each answered as e (e.id)}{@render entry(e)}{/each}
				{#if found.length}
					<li class="border-t border-zinc-800 px-3 pt-2 text-xs text-zinc-500">
						Con esas palabras
					</li>
				{/if}
			{/if}
			{#each found as e (e.id)}
				{@render entry(e)}
			{:else}
				{#if !answered}
					<li class="px-3 py-2 text-sm text-zinc-400">Nada en Ajustes con «{query.trim()}».</li>
				{/if}
			{/each}
			{#if ask && !answered}
				<li class="border-t border-zinc-800">
					<button
						type="button"
						onclick={askAi}
						disabled={asking}
						class="w-full px-3 py-2 text-left text-sm text-amber-400 hover:bg-zinc-900 disabled:text-zinc-500"
						>{asking ? 'Pensando…' : `✨ Preguntar a la IA: «${query.trim()}»`}</button
					>
				</li>
			{/if}
			{#if problem}
				<li class="px-3 pb-2 text-sm text-red-400">{problem}</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	/* Under the bar (--header-h) and the search and tabs that stay above: from here, and from any
	   link with its #id («/ajustes?seccion=casa#nube»). */
	:global(.settings [id]) {
		scroll-margin-top: calc(var(--header-h, 0px) + 7rem);
	}
	:global(.settings-found) {
		animation: settings-found 2s ease-out;
	}
	@keyframes settings-found {
		0%,
		40% {
			box-shadow: 0 0 0 2px rgb(245 158 11);
		}
		100% {
			box-shadow: 0 0 0 2px transparent;
		}
	}
</style>
