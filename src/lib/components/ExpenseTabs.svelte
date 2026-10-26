<script lang="ts">
	/** Gastos' two views (#194): a month's, and the analysis of several. */
	let { current }: { current: 'mes' | 'analisis' } = $props();

	const TABS = [
		{ id: 'mes', href: '/gastos', label: 'Mes' },
		{ id: 'analisis', href: '/gastos/analisis', label: 'Análisis' }
	] as const;
</script>

<nav class="mb-4 flex gap-1 border-b border-zinc-800">
	{#each TABS as t (t.id)}
		<a
			href={t.href}
			aria-current={t.id === current ? 'page' : undefined}
			class={[
				'-mb-px border-b-2 px-4 py-2 text-sm',
				t.id === current
					? 'border-amber-500 font-semibold text-white'
					: 'border-transparent text-zinc-400 hover:text-white'
			]}>{t.label}</a
		>
	{/each}
</nav>
