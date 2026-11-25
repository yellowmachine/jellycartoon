<script lang="ts">
	import { page } from '$app/state';

	/** Preguntar's tabs (#505): the chat, the summary and the reports made from the chat. Links: «back» works. */
	const TABS = [
		{ href: '/preguntar', label: 'Conversación' },
		{ href: '/preguntar/resumen', label: 'Resumen' },
		{ href: '/preguntar/informes', label: 'Informes' }
	];
	const current = $derived(
		TABS.findLast((t) => page.url.pathname.startsWith(t.href))?.href ?? '/preguntar'
	);
</script>

<nav class="mb-4 flex gap-5 border-b border-zinc-800">
	{#each TABS as t (t.href)}
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
