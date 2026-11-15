<script lang="ts">
	/** Energía's views (#396, #508, #513): the plugs, what they use, the temperature, what is to come. */
	let { current }: { current: 'enchufes' | 'consumo' | 'temperatura' | 'prevision' } = $props();

	const TABS = [
		{ id: 'enchufes', href: '/enchufes', label: 'Enchufes' },
		{ id: 'consumo', href: '/enchufes/consumo', label: 'Consumo' },
		{ id: 'temperatura', href: '/enchufes/temperatura', label: 'Temperatura' },
		{ id: 'prevision', href: '/enchufes/prevision', label: 'Previsión' }
	] as const;
</script>

<!-- Its line, a shadow inside and not a border, as AgendaTabs. -->
<nav class="mb-4 flex gap-0 overflow-x-auto shadow-[inset_0_-1px_0] shadow-zinc-800 sm:gap-1">
	{#each TABS as t (t.id)}
		<a
			href={t.href}
			aria-current={t.id === current ? 'page' : undefined}
			class={[
				'shrink-0 border-b-2 px-2.5 py-2 text-sm sm:px-4',
				t.id === current
					? 'border-amber-500 font-semibold text-white'
					: 'border-transparent text-zinc-400 hover:text-white'
			]}>{t.label}</a
		>
	{/each}
</nav>
