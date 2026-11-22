<script lang="ts">
	/** Paseos' sources (#593): the walks recorded here, and what OwnTracks sends from the phone. */
	let { current }: { current: 'app' | 'owntracks' } = $props();

	const TABS = [
		{ id: 'app', href: '/paseos', label: 'Desde la app' },
		{ id: 'owntracks', href: '/paseos/owntracks', label: 'OwnTracks' }
	] as const;
</script>

<!-- As ViajesTabs. -->
<nav class="mb-6 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0] shadow-zinc-800">
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
