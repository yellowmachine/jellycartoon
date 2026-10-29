<script lang="ts">
	/**
	 * Gastos' views (#194): a month's, the analysis of several, the bills' supplies (#232), a
	 * search by words and dates, and what the AI costs (#193).
	 */
	let { current }: { current: 'mes' | 'analisis' | 'facturas' | 'busqueda' | 'ia' } = $props();

	const TABS = [
		{ id: 'mes', href: '/gastos', label: 'Mes' },
		{ id: 'analisis', href: '/gastos/analisis', label: 'Análisis' },
		{ id: 'facturas', href: '/gastos/facturas', label: 'Facturas' },
		{ id: 'busqueda', href: '/gastos/busqueda', label: 'Búsqueda' },
		{ id: 'ia', href: '/gastos/ia', label: 'IA' }
	] as const;
</script>

<nav class="mb-4 flex gap-1 overflow-x-auto border-b border-zinc-800">
	{#each TABS as t (t.id)}
		<a
			href={t.href}
			aria-current={t.id === current ? 'page' : undefined}
			class={[
				'-mb-px shrink-0 border-b-2 px-4 py-2 text-sm',
				t.id === current
					? 'border-amber-500 font-semibold text-white'
					: 'border-transparent text-zinc-400 hover:text-white'
			]}>{t.label}</a
		>
	{/each}
</nav>
