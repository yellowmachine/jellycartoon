<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The Agenda's views (#253): what is written down, what will sound (the alarms and the
	 * timers), and each one's medication (#308). The alarms' with a dot while one is ringing, live
	 * with their channel.
	 */
	let { current }: { current: 'agenda' | 'alarmas' | 'medicacion' } = $props();

	const TABS = [
		{ id: 'agenda', href: '/agenda', label: 'Agenda' },
		{ id: 'alarmas', href: '/agenda/alarmas', label: 'Alarmas' },
		{ id: 'medicacion', href: '/agenda/medicacion', label: 'Medicación' }
	] as const;

	let ringing = $state(false);

	async function load() {
		const res = await fetch('/api/avisos/sonando').catch(() => null);
		if (res?.ok) ringing = (await res.json()).length > 0;
	}

	onMount(() => {
		void load();
		const events = new EventSource('/api/avisos/events');
		events.onmessage = () => void load();
		return () => events.close();
	});
</script>

<!-- Its line, a shadow inside and not a border: a tab drawn over a border, a pixel below, made a
scrollbar appear (overflow-x-auto scrolls up and down too). -->
<nav class="mb-4 flex gap-1 overflow-x-auto shadow-[inset_0_-1px_0] shadow-zinc-800">
	{#each TABS as t (t.id)}
		<a
			href={t.href}
			aria-current={t.id === current ? 'page' : undefined}
			class={[
				'flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2 text-sm',
				t.id === current
					? 'border-amber-500 font-semibold text-white'
					: 'border-transparent text-zinc-400 hover:text-white'
			]}
			>{t.label}{#if t.id === 'alarmas' && ringing}<span
					class="h-2 w-2 rounded-full bg-amber-400"
					title="Sonando"
				></span>{/if}</a
		>
	{/each}
</nav>
