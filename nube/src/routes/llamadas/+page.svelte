<script lang="ts">
	import GuideLink from '#lib/components/GuideLink.svelte';
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import CallPanel from '#lib/components/CallPanel.svelte';
	import { OUTCOME_TEXT, talkTime } from '#lib/calls.ts';
	import { phone } from '#lib/phone.svelte.ts';
	import { section } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	/**
	 * Llamadas (#330): who of the family to call, then the adults of each linked family (#464) under
	 * its name, the call itself here, and the history.
	 */
	let { data }: PageProps = $props();

	const when = new Intl.DateTimeFormat('es-ES', {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit'
	});

	/** With the call button (#330), its favorites first, in their order, and bigger. */
	const favorites = $derived(data.callButton?.favorites.map((f) => f.userId) ?? []);
	/**
	 * The favorites on top, in their order, whatever their family; then the rest of their own family;
	 * then each linked family under its name.
	 */
	const groups = $derived.by(() => {
		const chosen = data.people
			.filter((p) => favorites.includes(p.userId))
			.sort((a, b) => rank(a.userId) - rank(b.userId));
		const rest = data.people.filter((p) => !favorites.includes(p.userId));
		const linked = new Map<string, typeof data.people>();
		for (const p of rest) if (p.family) linked.set(p.family, [...(linked.get(p.family) ?? []), p]);
		return [
			{ family: null, people: [...chosen, ...rest.filter((p) => !p.family)] },
			...[...linked].map(([family, people]) => ({ family, people }))
		].filter((g) => g.people.length);
	});
	/** Just linked, from /vincular: said once. */
	const justLinked = $derived(page.url.searchParams.get('vinculada'));
	function rank(userId: string) {
		const i = favorites.indexOf(userId);
		return i === -1 ? favorites.length : i;
	}

	// Over: the history again, with this one.
	let was = $state(phone.state);
	$effect(() => {
		if (was !== 'ended' && phone.state === 'ended') void invalidateAll();
		was = phone.state;
	});
</script>

<svelte:head>
	<title>Llamadas · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<h1 class="mb-4 text-2xl font-bold">
		Llamadas<GuideLink page="llamadas" label="las llamadas" />
	</h1>

	{#if phone.state !== 'idle'}
		<div class="mb-8"><CallPanel /></div>
	{/if}

	<section class={section}>
		<h2 class="mb-3 text-lg font-semibold">Llamar</h2>
		{#if justLinked}
			<p class="mb-3 rounded-md bg-emerald-900/40 p-3 text-sm text-emerald-200">
				Vuestra familia ya está vinculada con {justLinked}: sus mayores salen aquí abajo.
			</p>
		{/if}
		{#if data.people.length}
			{#each groups as g (g.family)}
				{#if g.family}
					<h3 class="mt-5 mb-2 text-sm font-semibold text-zinc-400">{g.family}</h3>
				{/if}
				<ul class={['grid gap-2', !favorites.length && 'sm:grid-cols-2']}>
					{#each g.people as p (p.userId)}
						{@const favorite = favorites.includes(p.userId)}
						<li>
							<button
								class={[
									'flex w-full items-center gap-3 rounded-xl text-left disabled:opacity-50',
									favorite
										? 'bg-emerald-900/60 p-4 text-xl ring-1 ring-emerald-700 hover:bg-emerald-900'
										: 'bg-zinc-900 p-3 hover:bg-zinc-800'
								]}
								disabled={phone.busy}
								onclick={() => phone.call(p.userId, p.name)}
							>
								<span
									class={[
										'flex shrink-0 items-center justify-center rounded-full bg-emerald-700 font-bold text-white',
										favorite ? 'h-14 w-14 text-2xl' : 'h-10 w-10'
									]}
									aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span
								>
								<span class="min-w-0">
									<span class="block truncate font-semibold">{p.name}</span>
									{#if p.family && favorites.includes(p.userId)}
										<span class="block truncate text-sm text-emerald-200/70">{p.family}</span>
									{/if}
									{#if !p.notices}
										<span class="block text-sm text-zinc-400"
											>Sin avisos: solo sonará si tiene Seilide abierto</span
										>
									{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/each}
		{:else}
			<p class="text-zinc-400">No hay nadie más en tu familia con cuenta.</p>
		{/if}
		{#if !data.family?.kid && !data.people.some((p) => p.family)}
			<p class="mt-4 text-sm text-zinc-500">
				¿Abuelos, tíos, primos con su propia familia en Seilide?
				<a
					href="/ajustes?seccion=familia#familias-vinculadas"
					class="text-amber-400 hover:underline">Vincula su familia</a
				> para poder llamaros.
			</p>
		{/if}
	</section>

	<section class={section}>
		<h2 class="mb-3 text-lg font-semibold">Historial</h2>
		{#if data.history.length}
			<ul class="flex flex-col divide-y divide-zinc-800">
				{#each data.history as c (c.id)}
					<li class="flex items-center gap-3 py-2">
						<span
							class={[
								'w-6 text-center text-lg',
								c.outcome === 'missed' && !c.outgoing ? 'text-red-400' : 'text-zinc-400'
							]}
							aria-label={c.outgoing ? 'Hecha' : 'Recibida'}
							>{c.outgoing ? '↗\u{FE0E}' : '↙\u{FE0E}'}</span
						>
						<div class="min-w-0 flex-1">
							<p class="truncate font-semibold">{c.otherName}</p>
							<p class="text-sm text-zinc-400">
								{when.format(new Date(c.startedAt))} · {c.outcome
									? c.outcome === 'answered' && c.seconds !== null
										? talkTime(c.seconds)
										: OUTCOME_TEXT[c.outcome]
									: 'Ahora'}
							</p>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-zinc-400">Todavía no hay llamadas.</p>
		{/if}
	</section>
</div>
