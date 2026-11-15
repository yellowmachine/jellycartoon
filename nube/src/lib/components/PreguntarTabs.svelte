<script lang="ts">
	import { page } from '$app/state';

	/** Preguntar's two tabs (#505): the chat and the reports made from it. Links: «back» works. */
	const TABS = [
		{ href: '/preguntar', label: 'Conversación' },
		{ href: '/preguntar/informes', label: 'Informes' }
	];
	const current = $derived(
		page.url.pathname.startsWith('/preguntar/informes') ? '/preguntar/informes' : '/preguntar'
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
