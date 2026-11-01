<script lang="ts">
	import { page } from '$app/state';

	/**
	 * Seilide's stations and podcasts, as tabs that are links (like Ajustes). Podcasts are not for
	 * children yet.
	 */
	const podcasts = '/radio/podcasts';
	const tabs = $derived([
		{ href: '/radio', label: 'Emisoras' },
		{ href: podcasts, label: 'Podcasts' }
	]);
	const current = $derived(page.url.pathname.startsWith('/radio/podcasts') ? podcasts : '/radio');
</script>

{#if !page.data.kid}
	<nav class="mb-6 flex gap-5 overflow-x-auto border-b border-zinc-800">
		{#each tabs as t (t.href)}
			<a
				href={t.href}
				class={[
					'shrink-0 border-b-2 px-1 pb-2 text-sm',
					t.href === current
						? 'border-amber-500 text-white'
						: 'border-transparent text-zinc-400 hover:text-white'
				]}
				aria-current={t.href === current ? 'page' : undefined}>{t.label}</a
			>
		{/each}
	</nav>
{/if}
