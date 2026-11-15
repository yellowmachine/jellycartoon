<script lang="ts">
	/** Enchufes' views (#396, #508): the plugs, what they use, and the temperature. */
	let { current }: { current: 'enchufes' | 'consumo' | 'temperatura' } = $props();

	const TABS = [
		{ id: 'enchufes', href: '/enchufes', label: 'Enchufes' },
		{ id: 'consumo', href: '/enchufes/consumo', label: 'Consumo' },
		{ id: 'temperatura', href: '/enchufes/temperatura', label: 'Temperatura' }
	] as const;
</script>

<!-- Its line, a shadow inside and not a border, as AgendaTabs. -->
<nav class="mb-4 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0] shadow-zinc-800">
	{#each TABS as t (t.id)}
		<a
			href={t.href}
			aria-current={t.id === current ? 'page' : undefined}
			class={[
				'shrink-0 border-b-2 px-4 py-2 text-sm',
				t.id === current
					? 'border-amber-500 font-semibold text-white'
					: 'border-transparent text-zinc-400 hover:text-white'
			]}>{t.label}</a
		>
	{/each}
</nav>
