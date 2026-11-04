<script lang="ts">
	import { enhance } from '$app/forms';
	import type { AgendaPerson } from 'comun/agenda.ts';
	import type { EventPaper } from 'comun/papers.ts';
	import PaperForm, {
		afterPaperAction,
		asPaperFile,
		type PaperDraft
	} from '#lib/components/PaperForm.svelte';
	import PaperPick from '#lib/components/PaperPick.svelte';

	/**
	 * The papers of an event of the agenda (#399): papers of Papeles, sealed the same, new or chosen
	 * from there, by whose actions they are kept. Taken out of here, they stay there.
	 */
	let {
		eventId,
		title,
		papers,
		people,
		eventPeople
	}: {
		eventId: number;
		title: string;
		papers: EventPaper[];
		people: AgendaPerson[];
		/** Who the event is for: whose a new paper of it is, to begin with. */
		eventPeople: string[];
	} = $props();

	let draft = $state<PaperDraft | null>(null);
	let file = $state<File | null>(null);
	/** Those to choose from; null, not asked for. */
	let choices = $state<{ id: number; name: string }[] | null>(null);
	let loading = $state(false);
	let problem = $state<string | null>(null);

	const others = $derived(choices?.filter((c) => !papers.some((p) => p.id === c.id)) ?? []);

	async function fromFile(original: File) {
		problem = null;
		choices = null;
		file = null;
		draft = {
			id: null,
			name: title.trim(),
			category: 'Otros',
			notes: '',
			people: [...eventPeople]
		};
		file = await asPaperFile(original);
	}

	async function choose() {
		loading = true;
		problem = null;
		try {
			const res = await fetch('/papeles/lista');
			if (!res.ok) throw new Error(String(res.status));
			choices = await res.json();
		} catch {
			problem = 'No se han podido leer los papeles. Prueba en un rato';
		} finally {
			loading = false;
		}
	}

	const failed = (result: { type: string; data?: Record<string, unknown> }) => {
		if (result.type === 'failure')
			problem = String(result.data?.message ?? 'No se ha podido cambiar');
		else if (result.type === 'error') problem = 'No se ha podido cambiar';
		else problem = null;
	};

	const button = 'rounded-md px-3 py-1.5 text-sm disabled:opacity-40';
</script>

<div class="border-t border-zinc-800 pt-3">
	<h3 class="mb-1 text-sm font-semibold">Papeles</h3>
	<p class="mb-2 text-xs text-zinc-500">
		La cita, una solicitud… Se guardan cifrados, también en Papeles, para los adultos de la familia.
	</p>

	{#if papers.length}
		<ul class="mb-3">
			{#each papers as p (p.id)}
				<li class="flex items-center gap-2 py-1">
					{#if p.name === null}
						<span class="min-w-0 flex-1 text-sm text-amber-200">
							Este papel no se puede leer ahora. Prueba en un rato.
						</span>
					{:else}
						<a
							href="/papeles/{p.id}/fichero"
							target="_blank"
							rel="noreferrer"
							class="min-w-0 flex-1 text-sm break-words text-amber-400 hover:underline"
							>{p.file === 'pdf' ? '📄' : '🖼️'} {p.name}</a
						>
					{/if}
					<form
						method="post"
						action="/papeles?/unlink"
						use:enhance={() =>
							({ result }) => {
								failed(result);
								return afterPaperAction(result);
							}}
					>
						<input type="hidden" name="id" value={p.id} />
						<input type="hidden" name="event" value={eventId} />
						<button
							class="{button} shrink-0 px-2 text-zinc-400 hover:bg-zinc-800"
							title="Quitar de aquí (sigue en Papeles)"
							aria-label="Quitar {p.name ?? 'este papel'} de aquí (sigue en Papeles)">✕</button
						>
					</form>
				</li>
			{/each}
		</ul>
	{/if}

	{#if draft}
		<PaperForm
			action="/papeles?/save"
			{draft}
			{people}
			{eventId}
			{file}
			onclose={() => {
				draft = null;
				file = null;
			}}
		/>
	{:else}
		<div class="flex flex-wrap items-center gap-2">
			<PaperPick onpick={fromFile} />
			{#if !choices}
				<button
					type="button"
					class="{button} bg-zinc-800 hover:bg-zinc-700"
					disabled={loading}
					onclick={choose}>{loading ? 'Leyendo…' : '🗂️ Elegir de Papeles'}</button
				>
			{/if}
		</div>
		{#if choices}
			{#if others.length}
				<form
					method="post"
					action="/papeles?/link"
					class="mt-2 flex flex-wrap items-center gap-2"
					use:enhance={() =>
						async ({ result }) => {
							failed(result);
							await afterPaperAction(result);
							if (result.type === 'success') choices = null;
						}}
				>
					<input type="hidden" name="event" value={eventId} />
					<select
						name="id"
						aria-label="Papel que añadir"
						class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
					>
						{#each others as c (c.id)}
							<option value={c.id}>{c.name}</option>
						{/each}
					</select>
					<button class="{button} bg-zinc-800 hover:bg-zinc-700">Añadir</button>
					<button
						type="button"
						class="{button} text-zinc-400 hover:bg-zinc-800"
						onclick={() => (choices = null)}>Cancelar</button
					>
				</form>
			{:else}
				<p class="mt-2 text-sm text-zinc-500">No hay más papeles que elegir.</p>
			{/if}
		{/if}
	{/if}
	{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
</div>
