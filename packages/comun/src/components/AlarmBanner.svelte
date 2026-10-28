<script lang="ts">
	import { onMount } from 'svelte';

	/**
	 * The alarms and timers ringing now (#241), on every page: what and where, and «Parar». Live,
	 * with the Agenda's channel: stopped anywhere (another device, «Alexa» on a satellite), it goes.
	 */

	interface Ringing {
		id: number;
		label: string;
		where: string;
	}

	let ringing = $state<Ringing[]>([]);
	let stopping = $state<number | null>(null);

	async function load() {
		const res = await fetch('/api/avisos/sonando').catch(() => null);
		if (res?.ok) ringing = await res.json();
	}

	async function stop(id: number) {
		stopping = id;
		await fetch(`/api/avisos/${id}/parar`, { method: 'POST' }).catch(() => {});
		await load();
		stopping = null;
	}

	onMount(() => {
		void load();
		const events = new EventSource('/api/avisos/events');
		events.onmessage = () => void load();
		return () => events.close();
	});
</script>

{#each ringing as alarm (alarm.id)}
	<div
		class="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/15 px-4 py-2 text-center text-amber-200"
		role="alert"
	>
		<span class="text-base"
			>⏰ Suena: <strong>{alarm.label}</strong>
			<span class="text-sm text-amber-300/80">({alarm.where})</span></span
		>
		<button
			class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
			disabled={stopping === alarm.id}
			onclick={() => stop(alarm.id)}>{stopping === alarm.id ? 'Parando…' : 'Parar'}</button
		>
	</div>
{/each}
