<script lang="ts">
	import { enhance } from '$app/forms';
	import { euros } from 'comun/expenses.ts';
	import type { MoneyDocument, Paper, PaperCategory, PaperEvent } from 'comun/papers.ts';
	import PaperForm, { asPaperFile, type PaperDraft } from '#lib/components/PaperForm.svelte';
	import PaperPick from '#lib/components/PaperPick.svelte';
	import type { PageProps } from './$types';

	/**
	 * Papeles (#384): the family's important documents, a rent contract, an insurance policy, from
	 * a photo or a file, each with its free notes. Sealed on the server; never read by the AI.
	 */
	let { data }: PageProps = $props();

	/** The one being written. */
	let draft = $state<PaperDraft | null>(null);
	/** The photo or file a new one was opened with. */
	let file = $state<File | null>(null);
	let search = $state('');
	/** The one asked «¿Borrar?» about. */
	let deleting = $state<number | null>(null);

	const personName = (id: string) => data.people.find((p) => p.id === id)?.name;
	const ownerNames = (p: Paper) => p.people.flatMap((id) => personName(id) ?? []);

	/** «Salud · De Lucía · Lo guardó Ana». */
	const paperLine = (p: Paper) =>
		[
			p.category,
			ownerNames(p).length ? `De ${ownerNames(p).join(', ')}` : '',
			p.by ? `Lo guardó ${p.by}` : ''
		]
			.filter(Boolean)
			.join(' · ');

	// ——— Filters: only those there is something to filter by ———

	let category = $state<PaperCategory | null>(null);
	let person = $state<string | null>(null);
	const categories = $derived([...new Set(data.papers.map((p) => p.category))].sort());
	const owners = $derived(
		data.people.filter((who) => data.papers.some((p) => p.people.includes(who.id)))
	);
	const filtering = $derived(category !== null || person !== null);

	const found = $derived.by(() => {
		const words = search.trim().toLocaleLowerCase('es');
		return data.papers.filter(
			(p) =>
				(!category || p.category === category) &&
				(!person || p.people.includes(person)) &&
				(!words ||
					[p.name, p.notes, p.category, ...p.events.map((e) => e.title), ...ownerNames(p)].some(
						(text) => text?.toLocaleLowerCase('es').includes(words)
					))
		);
	});

	// ——— Also in Dinero, only as words are looked for, without filters: those are the papers' ———

	let money = $state<MoneyDocument[]>([]);
	let moneyFailed = $state(false);

	$effect(() => {
		const q = search.trim();
		money = [];
		moneyFailed = false;
		if (q.length < 2 || filtering) return;
		const asking = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const res = await fetch('/papeles/en-dinero', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ q }),
					signal: asking.signal
				});
				if (!res.ok) throw new Error(String(res.status));
				money = await res.json();
			} catch {
				if (!asking.signal.aborted) moneyFailed = true;
			}
		}, 300);
		return () => {
			clearTimeout(timer);
			asking.abort();
		};
	});

	const MONEY_KINDS = {
		gasto: '🧾 Gasto',
		factura: '🧾 Factura',
		ingreso: '💶 Ingreso'
	} as const;

	/** «12 nov 2026». */
	const dayText = (day: string) =>
		new Date(`${day}T12:00:00Z`).toLocaleDateString('es-ES', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});

	function edit(p: Paper) {
		file = null;
		draft = {
			id: p.id,
			name: p.name ?? '',
			category: p.category,
			notes: p.notes ?? '',
			people: [...p.people]
		};
	}

	/** A new one from a photo or a file: the form open with it, to give it a name. */
	async function fromFile(original: File) {
		file = null;
		draft = { id: null, name: '', category: 'Casa', notes: '', people: [] };
		file = await asPaperFile(original);
	}

	/** «Médico, 12 nov 2026»; one that repeats, by its name. */
	function eventName(e: PaperEvent) {
		if (e.repeats) return `${e.title} 🔁`;
		return `${e.title}, ${dayText(e.day)}`;
	}

	const field =
		'rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500';
	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
	const chip = (on: boolean) =>
		[
			'rounded-full border px-3 py-1 text-sm',
			on ? 'border-amber-500 text-amber-300' : 'border-zinc-700 text-zinc-300 hover:bg-zinc-800'
		].join(' ');
</script>

<svelte:head>
	<title>Papeles · Seilide</title>
</svelte:head>

<div class="mx-auto max-w-3xl">
	<h1 class="mb-3 text-2xl font-bold">Papeles</h1>
	<p class="mb-4 text-sm text-zinc-400">
		Los documentos importantes de la casa: el contrato de alquiler, un seguro… Para los adultos de
		la familia. Se guardan cifrados, con sus anotaciones, y la IA no los lee.
	</p>

	{#if !data.ready}
		<p class="rounded-md border border-amber-700/60 bg-amber-950/40 p-3 text-sm text-amber-200">
			Papeles no está disponible en este servidor: necesita el cifrado con KMS y donde guardar los
			ficheros.
		</p>
	{:else}
		{#if draft}
			{#key draft}
				<div class="mb-6">
					<PaperForm
						action="?/save"
						{draft}
						people={data.people}
						{file}
						onclose={() => {
							draft = null;
							file = null;
						}}
					/>
				</div>
			{/key}
		{:else}
			<div class="mb-6 flex flex-wrap gap-2">
				<PaperPick onpick={fromFile} />
			</div>
		{/if}

		<input
			type="search"
			bind:value={search}
			class="{field} mb-3 w-full"
			placeholder="Buscar en los papeles y en lo de Dinero"
			aria-label="Buscar en los papeles y en lo de Dinero"
		/>

		{#if categories.length > 1 || owners.length}
			<div class="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filtrar los papeles">
				{#if categories.length > 1}
					{#each categories as c (c)}
						<button
							type="button"
							class={chip(category === c)}
							aria-pressed={category === c}
							onclick={() => (category = category === c ? null : c)}>{c}</button
						>
					{/each}
				{/if}
				{#each owners as who (who.id)}
					<button
						type="button"
						class={chip(person === who.id)}
						aria-pressed={person === who.id}
						onclick={() => (person = person === who.id ? null : who.id)}>De {who.name}</button
					>
				{/each}
			</div>
		{/if}

		<ul class="mb-6 divide-y divide-zinc-800">
			{#each found as p (p.id)}
				<li class="py-3">
					{#if p.name === null}
						<p class="text-sm text-amber-200">
							Este papel no se puede leer ahora. Prueba en un rato.
						</p>
					{:else}
						<div class="flex items-start gap-2">
							<div class="min-w-0 flex-1">
								<a
									href="/papeles/{p.id}/fichero"
									target="_blank"
									rel="noreferrer"
									class="font-medium break-words text-amber-400 hover:underline"
									>{p.file === 'pdf' ? '📄' : '🖼️'} {p.name}</a
								>
								<p class="text-xs text-zinc-500">
									{paperLine(p)}
								</p>
								{#if p.events.length}
									<p class="text-xs text-zinc-500">
										{p.events.length > 1 ? 'De las citas:' : 'De la cita:'}
										{#each p.events as e, i (e.id)}
											{i ? ', ' : ''}<a
												href="/agenda?dia={e.day}&evento={e.id}"
												class="text-zinc-300 hover:underline">{eventName(e)}</a
											>
										{/each}
									</p>
								{/if}
							</div>
							<button
								class="{button} shrink-0 px-2 text-zinc-400 hover:bg-zinc-800"
								aria-label="Cambiar {p.name}"
								title="Cambiar"
								onclick={() => edit(p)}>✎</button
							>
							<button
								class="{button} shrink-0 px-2 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
								aria-label="Borrar {p.name}"
								title="Borrar"
								onclick={() => (deleting = p.id)}>✕</button
							>
						</div>
						{#if p.notes}
							<p class="mt-1 text-sm break-words whitespace-pre-wrap text-zinc-300">{p.notes}</p>
						{/if}
						{#if deleting === p.id}
							<form
								method="post"
								action="?/delete"
								use:enhance={() =>
									({ update }) => {
										deleting = null;
										return update();
									}}
								class="mt-2 flex flex-wrap items-center gap-2"
							>
								<input type="hidden" name="id" value={p.id} />
								<span class="text-sm">¿Borrar «{p.name}» y su fichero? No se puede deshacer.</span>
								<button class="{button} bg-red-700 hover:bg-red-600">Sí</button>
								<button
									type="button"
									class="{button} hover:bg-zinc-800"
									onclick={() => (deleting = null)}>No</button
								>
							</form>
						{/if}
					{/if}
				</li>
			{:else}
				<li class="py-4 text-zinc-400">
					{data.papers.length ? 'Ningún papel con eso.' : 'Ningún papel guardado todavía.'}
				</li>
			{/each}
		</ul>

		{#if money.length}
			<section class="mb-10">
				<h2 class="mb-1 font-semibold">También en Dinero</h2>
				<p class="mb-2 text-xs text-zinc-500">
					Tickets y facturas de tus gastos e ingresos. No van cifrados como los papeles, y la IA
					puede leerlos al apuntarlos.
				</p>
				<ul class="divide-y divide-zinc-800">
					{#each money as m (`${m.kind}-${m.id}`)}
						<li class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
							<div class="min-w-0 flex-1 basis-48">
								<a
									href={m.file}
									target="_blank"
									rel="noreferrer"
									class="break-words text-amber-400 hover:underline">{m.title}</a
								>
								<p class="text-xs text-zinc-500">
									{[
										MONEY_KINDS[m.kind],
										dayText(m.day),
										euros(m.amount),
										m.line ? `«${m.line}»` : ''
									]
										.filter(Boolean)
										.join(' · ')}
								</p>
							</div>
							<a href={m.place} class="shrink-0 text-sm text-zinc-400 hover:underline"
								>Ver en Dinero</a
							>
						</li>
					{/each}
				</ul>
			</section>
		{:else if moneyFailed}
			<p class="mb-10 text-sm text-amber-200">No se ha podido buscar en Dinero ahora.</p>
		{/if}
	{/if}
</div>
