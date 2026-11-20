<script lang="ts">
	import { onMount } from 'svelte';
	import { formatLeft } from 'comun/timer-names.ts';
	import { timers } from '#lib/timers.svelte.ts';
	import { vista } from '#lib/vista.svelte.ts';

	/**
	 * The whole house's timers in the Vista (#557): a rule's «sacar las bebidas del congelador», one
	 * said «en casa». Those counting, beside the Vista's own, each with its × (taken away
	 * everywhere); those ringing are in the banner above («Suena», with «Parar»). Live, with the
	 * Agenda's channel. Without satellites, nothing else rings them: then the Vista does, with its
	 * own timers' «din-don», until they are stopped (here, by voice or on another device).
	 */

	interface HouseTimer {
		id: number;
		label: string;
		endsAt: number | null;
		ringing: boolean;
	}

	/** As its own timers: a «din-don» this often, and no longer than this. */
	const CHIME_EVERY_MS = 2500;
	const RING_MAX_MS = 3 * 60_000;

	let list = $state<HouseTimer[]>([]);
	let ringHere = $state(false);
	let now = $state(Date.now());

	let loadedAt = 0;

	async function load() {
		loadedAt = Date.now();
		const res = await fetch('/api/avisos/casa').catch(() => null);
		if (!res?.ok) return;
		const body = (await res.json()) as { timers: HouseTimer[]; ringHere: boolean };
		list = body.timers;
		ringHere = body.ringHere;
	}

	async function cancel(id: number) {
		list = list.filter((t) => t.id !== id);
		await fetch('/api/avisos/casa', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id })
		}).catch(() => {});
		await load();
	}

	const counting = $derived(list.filter((t) => !t.ringing && t.endsAt));
	const ringing = $derived(list.some((t) => t.ringing));

	onMount(() => {
		void load();
		const events = new EventSource('/api/avisos/events');
		events.onmessage = () => void load();
		// It rings by the server's clock (a minute's look): asked again now and then once one should
		// have ended, until the channel says it rings.
		const tick = setInterval(() => {
			now = Date.now();
			if (counting.some((t) => t.endsAt! <= now) && now - loadedAt > 10_000) void load();
		}, 1000);
		return () => {
			events.close();
			clearInterval(tick);
		};
	});

	// Ringing: the Vista does not rest (its banner shows it), as with its own timers.
	$effect(() => {
		if (!ringing) return;
		vista.touchedAt = Date.now();
		const id = setInterval(() => (vista.touchedAt = Date.now()), 1000);
		return () => clearInterval(id);
	});

	// Ringing with nothing else to ring it: here, with a limit, as its own timers.
	$effect(() => {
		if (!ringing || !ringHere) return;
		const started = Date.now();
		timers.chime();
		const id = setInterval(() => {
			if (Date.now() - started > RING_MAX_MS) return clearInterval(id);
			timers.chime();
		}, CHIME_EVERY_MS);
		return () => clearInterval(id);
	});
</script>

{#if counting.length}
	<div class="flex flex-wrap gap-2" aria-label="Temporizadores de la casa">
		{#each counting as timer (timer.id)}
			<span
				class="flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 py-1 pr-1 pl-3 text-sm"
				title="De toda la casa"
			>
				<span aria-hidden="true">🏠</span>
				<span class="max-w-40 truncate">{timer.label}</span>
				<span class="font-mono text-amber-400 tabular-nums"
					>{formatLeft(Math.max(0, (timer.endsAt! - now) / 1000))}</span
				>
				<button
					class="flex h-6 w-6 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white"
					aria-label="Quitar el temporizador de la casa {timer.label}"
					onclick={() => cancel(timer.id)}>×</button
				>
			</span>
		{/each}
	</div>
{/if}
