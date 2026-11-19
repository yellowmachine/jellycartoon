<script lang="ts">
	import { sendMyLocation } from '#lib/location-send.svelte.ts';
	import { tripShare } from '#lib/trip-share.svelte.ts';

	/**
	 * «Mandar mi ubicación» (#550) by hand: to someone they may call (their family, an adult of a
	 * linked family), where they are now or the trip as it goes. In the road mode, big and with its
	 * own way to share the trip (its destination and arrival); elsewhere, the site's size.
	 */
	interface Person {
		userId: string;
		name: string;
		family?: string;
	}
	let {
		people,
		startShare,
		big = false
	}: { people: Person[]; startShare?: () => Promise<void>; big?: boolean } = $props();

	let to = $state<string | null>(null);
	let busy = $state<'aqui' | 'viaje' | null>(null);
	let said = $state<{ ok: boolean; text: string } | null>(null);

	async function send(live: boolean) {
		const person = people.find((p) => p.userId === to);
		if (!person || busy) return;
		busy = live ? 'viaje' : 'aqui';
		said = null;
		try {
			said = { ok: true, text: await sendMyLocation(person, live, startShare) };
		} catch (err) {
			said = { ok: false, text: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = null;
		}
	}

	const chip = $derived(big ? 'rounded-xl px-4 py-3 text-lg' : 'rounded-full px-3 py-1 text-sm');
	const action = $derived(
		big
			? 'rounded-xl px-5 py-3 text-lg font-semibold'
			: 'rounded-md px-3 py-1.5 text-sm font-medium'
	);
</script>

<div class={big ? 'rounded-2xl bg-zinc-900 p-4' : ''}>
	<p class={big ? 'mb-3 text-xl font-semibold' : 'mb-2 text-sm text-zinc-400'}>
		{big ? 'Mandar mi ubicación' : '¿A quién?'}
	</p>
	<div class="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="A quién">
		{#each people as p (p.userId)}
			<button
				role="radio"
				aria-checked={to === p.userId}
				class={[
					chip,
					to === p.userId
						? 'bg-amber-500 text-zinc-950'
						: 'border border-zinc-700 text-zinc-200 hover:bg-zinc-800'
				]}
				onclick={() => ((to = p.userId), (said = null))}
				>{p.name}{#if p.family}<span class="opacity-70"> · {p.family}</span>{/if}</button
			>
		{/each}
	</div>
	<div class="flex flex-wrap gap-2">
		<button
			class={[action, 'bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:opacity-50']}
			disabled={!to || busy !== null}
			onclick={() => send(false)}>{busy === 'aqui' ? 'Mandando…' : 'Dónde estoy ahora'}</button
		>
		<button
			class={[action, 'border border-zinc-700 hover:bg-zinc-800 disabled:opacity-50']}
			disabled={!to || busy !== null}
			onclick={() => send(true)}
			>{busy === 'viaje'
				? 'Compartiendo…'
				: tripShare.url
					? 'Mandarle el viaje en directo'
					: 'Compartir el viaje en directo'}</button
		>
	</div>
	{#if said}
		<p
			class={['mt-2', big ? 'text-base' : 'text-sm', said.ok ? 'text-emerald-400' : 'text-red-400']}
			role="status"
		>
			{said.ok ? '✓ ' : ''}{said.text}
		</p>
	{/if}
	<p class={['mt-2 text-zinc-500', big ? 'text-sm' : 'text-xs']}>
		Le llega un aviso al móvil y a su Buzón. «En directo» dura hasta que llegues o lo dejes de
		compartir.
	</p>
</div>
