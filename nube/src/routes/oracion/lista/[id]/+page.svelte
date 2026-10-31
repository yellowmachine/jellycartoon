<script lang="ts">
	import { enhance } from '$app/forms';
	import { MAX_ITEMS, MAX_PAUSE, MAX_TIMES, MAX_TITLE } from '#lib/prayers.ts';
	import { field, primary, secondary, select } from '#lib/styles.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/** As the page has it: sent whole when saved; from what is saved, on coming to another list. */
	let title = $state('');
	let pauseSec = $state(3);
	let items = $state<{ prayerId: number; times: number }[]>([]);
	let adding = $state('');
	$effect.pre(() => {
		title = data.list?.title ?? '';
		pauseSec = data.list?.pauseSec ?? 3;
		items = (data.list?.items ?? []).map((i) => ({ ...i }));
		adding = String(data.prayers[0]?.id ?? '');
	});
	let deleting = $state(false);

	const titleOf = (id: number) => data.prayers.find((p) => p.id === id)?.title ?? '—';
	const noVoice = (id: number) => !data.prayers.find((p) => p.id === id)?.hasVoice;

	function add() {
		const prayerId = Number(adding);
		if (prayerId && items.length < MAX_ITEMS) items.push({ prayerId, times: 1 });
	}

	function move(i: number, by: number) {
		const j = i + by;
		if (j < 0 || j >= items.length) return;
		[items[i], items[j]] = [items[j], items[i]];
	}

	const body = $derived(JSON.stringify({ title, pauseSec, items }));
</script>

<svelte:head>
	<title>{data.list?.title ?? 'Nueva lista'} · Oración · JellyCartoon</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<a href="/oracion" class="mb-3 inline-block text-sm text-zinc-400 hover:underline">← Oración</a>
	<h1 class="mb-4 text-2xl font-bold">{data.list ? 'Lista' : 'Nueva lista'}</h1>

	<div class="flex flex-col gap-4">
		<label class="flex flex-col gap-1 text-xs text-zinc-400">
			Título
			<input
				bind:value={title}
				maxlength={MAX_TITLE}
				class={field}
				placeholder="Rosario, Laudes…"
			/>
		</label>
		<label class="flex items-center gap-2 text-sm text-zinc-300">
			Pausa entre textos
			<input type="number" min="0" max={MAX_PAUSE} bind:value={pauseSec} class="{field} w-20" />
			s
		</label>

		<ol class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#each items as item, i (i)}
				<li class="flex items-center gap-2 px-3 py-2">
					<span class="w-6 shrink-0 text-right text-sm text-zinc-500 tabular-nums">{i + 1}</span>
					<span class="min-w-0 flex-1">
						<span class="block truncate">{titleOf(item.prayerId)}</span>
						{#if noVoice(item.prayerId)}<span class="block text-xs text-amber-400"
								>Sin voz todavía: se salta</span
							>{/if}
					</span>
					<label class="flex items-center gap-1 text-sm text-zinc-400">
						×
						<input
							type="number"
							min="1"
							max={MAX_TIMES}
							bind:value={item.times}
							class="{field} w-16"
							aria-label="Veces"
						/>
					</label>
					<button
						type="button"
						class="px-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
						disabled={i === 0}
						onclick={() => move(i, -1)}
						aria-label="Subir">↑</button
					>
					<button
						type="button"
						class="px-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30"
						disabled={i === items.length - 1}
						onclick={() => move(i, 1)}
						aria-label="Bajar">↓</button
					>
					<button
						type="button"
						class="px-1 text-zinc-400 hover:text-red-400"
						onclick={() => items.splice(i, 1)}
						aria-label="Quitar">✕</button
					>
				</li>
			{:else}
				<li class="px-3 py-2 text-sm text-zinc-600">Sin textos todavía.</li>
			{/each}
		</ol>

		{#if data.prayers.length}
			<div class="flex flex-wrap items-center gap-2">
				<select bind:value={adding} class={select}>
					{#each data.prayers as p (p.id)}
						<option value={String(p.id)}>{p.title}</option>
					{/each}
				</select>
				<button type="button" class={secondary} onclick={add} disabled={items.length >= MAX_ITEMS}
					>+ Añadir</button
				>
			</div>
		{:else}
			<p class="text-sm text-zinc-400">
				Todavía no hay textos. <a href="/oracion/texto/nuevo" class="text-amber-400 hover:underline"
					>Crear uno</a
				>
			</p>
		{/if}

		<form method="post" action="?/save" use:enhance>
			<input type="hidden" name="list" value={body} />
			<button class={primary} disabled={!title.trim()}>Guardar</button>
		</form>
		{#if form && 'problem' in form}
			<p class="text-sm text-red-400">{form.problem}</p>
		{/if}
	</div>

	{#if data.list}
		<form method="post" action="?/delete" class="mt-8" use:enhance>
			{#if deleting}
				<span class="text-sm text-zinc-300">¿Borrar la lista? Los textos se quedan.</span>
				<button class="ml-2 text-sm text-red-400 hover:underline">Sí, borrar</button>
				<button type="button" class="ml-2 text-sm text-zinc-400" onclick={() => (deleting = false)}
					>No</button
				>
			{:else}
				<button
					type="button"
					class="text-sm text-red-400 hover:underline"
					onclick={() => (deleting = true)}>Borrar</button
				>
			{/if}
		</form>
	{/if}
</div>
