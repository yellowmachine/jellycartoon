<script lang="ts">
	import { onMount } from 'svelte';
	import { avatar, PERMITS, type PermitId } from '#lib/avatars.ts';

	/**
	 * A child asking to enter on a device of the house (#141), shown to its parents or guardians on
	 * any page: yes for this time, for a while or for the day, or no. Live, while the app is open.
	 */
	interface Pending {
		id: string;
		name: string;
		avatar: string;
		device: string;
	}

	let pending = $state<Pending[]>([]);
	let busy = $state<string | null>(null);
	let problem = $state<string | null>(null);

	onMount(() => {
		const events = new EventSource('/api/peques/peticiones');
		events.onmessage = (e) => (pending = JSON.parse(e.data));
		return () => events.close();
	});

	async function answer(id: string, value: PermitId | 'no') {
		busy = id;
		problem = null;
		const res = await fetch(`/api/peques/peticiones/${id}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ answer: value })
		}).catch(() => null);
		busy = null;
		if (!res?.ok) problem = 'No se pudo contestar. Prueba otra vez.';
		else if ((await res.json()).result === 'late')
			problem = 'Ya había contestado otro adulto, o pasó el tiempo.';
	}
</script>

{#if pending.length || problem}
	<div class="fixed inset-x-0 top-2 z-40 mx-auto flex max-w-md flex-col gap-2 px-4" role="alert">
		{#each pending as request (request.id)}
			{@const a = avatar(request.avatar)}
			<div class="rounded-xl border border-amber-500/50 bg-zinc-900 p-4 shadow-2xl">
				<div class="mb-3 flex items-center gap-3">
					<span
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-3xl {a.color}"
						>{a.emoji}</span
					>
					<p class="text-zinc-100">
						<span class="font-semibold">{request.name}</span> quiere entrar en {request.device}.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					{#each PERMITS as permit (permit.id)}
						<button
							class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
							disabled={busy === request.id}
							onclick={() => answer(request.id, permit.id)}>{permit.label}</button
						>
					{/each}
					<button
						class="ml-auto rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
						disabled={busy === request.id}
						onclick={() => answer(request.id, 'no')}>No</button
					>
				</div>
			</div>
		{/each}
		{#if problem}
			<button
				class="rounded-xl bg-zinc-900 p-3 text-left text-sm text-amber-300 shadow-2xl"
				onclick={() => (problem = null)}>{problem}</button
			>
		{/if}
	</div>
{/if}
