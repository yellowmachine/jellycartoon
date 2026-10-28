<script lang="ts" generics="Tab extends string, Shown">
	import { goto } from '$app/navigation';
	import { searchSettings, type SettingsEntry } from '../settings-search.ts';

	/**
	 * «Buscar en Ajustes», above its tabs, in the house and in the cloud (#253): a word, and the
	 * sections that have it in any tab (each app's `index`); one chosen, its tab opens on it, lit for
	 * a moment.
	 */
	let {
		index,
		labels,
		shown,
		placeholder = 'Buscar en Ajustes: subtítulos, niños, clave…'
	}: {
		index: SettingsEntry<Tab, Shown>[];
		labels: Record<Tab, string>;
		shown: Shown;
		placeholder?: string;
	} = $props();

	let query = $state('');
	const found = $derived(searchSettings(index, labels, query, shown));

	const href = (e: SettingsEntry<Tab, Shown>) => `?seccion=${e.tab}#${e.id}`;

	async function open(e: SettingsEntry<Tab, Shown>) {
		query = '';
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
			if (e.key === 'Enter' && found[0]) {
				e.preventDefault();
				void open(found[0]);
			}
		}}
	/>
	{#if query.trim()}
		<ul
			class="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-950 shadow-xl"
		>
			{#each found as e (e.id)}
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
			{:else}
				<li class="px-3 py-2 text-sm text-zinc-400">Nada en Ajustes con «{query.trim()}».</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	:global(.settings-found) {
		animation: settings-found 2s ease-out;
		scroll-margin-top: 4rem;
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
