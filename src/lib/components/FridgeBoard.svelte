<script lang="ts">
	import '@fontsource/comic-neue/400.css';
	import '@fontsource/comic-neue/700.css';
	import {
		LIST_PAPER,
		MAX_ITEM,
		MAX_NOTE,
		PAPERS,
		tiltFor,
		untilChoices,
		untilText,
		type FridgeState
	} from '#lib/fridge.ts';
	import { dayEvents, dayName, isOver, localTime, timeOn } from '#lib/agenda.ts';

	/**
	 * The fridge's door (#131): the house's post-its, crooked, in each person's colour and in a hand's
	 * letter, with a magnet; the shopping list, on squared paper, with its items to tick off; and the
	 * agenda's «Hoy» (#200), a calendar's sheet only to look at. To write on it, or only to look at
	 * it (the TV, `big`).
	 */
	let {
		fridge,
		readonly = false,
		big = false
	}: { fridge: FridgeState; readonly?: boolean; big?: boolean } = $props();

	let problem = $state<string | null>(null);

	async function send(body: Record<string, unknown>) {
		problem = null;
		const res = await fetch('/api/nevera', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		}).catch(() => null);
		if (!res?.ok) problem = 'No se pudo guardar. Prueba otra vez.';
		return res?.ok ?? false;
	}

	// A new post-it.
	let text = $state('');
	let until = $state<string | null>(null);
	const choices = untilChoices();
	async function stick(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim()) return;
		if (await send({ action: 'note', text, until })) {
			text = '';
			until = null;
		}
	}

	/** Asked twice, without a dialog. */
	let peeling = $state<number | null>(null);

	// A post-it changed where it is: its words in a textarea on the same paper, until saved.
	let editing = $state<number | null>(null);
	let draft = $state('');
	let saving = $state(false);

	function edit(note: { id: number; text: string }) {
		peeling = null;
		editing = note.id;
		draft = note.text;
	}

	async function save(note: { id: number; text: string }) {
		if (!draft.trim() || saving) return;
		if (draft.trim() === note.text) return void (editing = null);
		saving = true;
		if (await send({ action: 'edit', id: note.id, text: draft })) editing = null;
		saving = false;
	}

	/** Esc leaves it as it was; Ctrl+Enter (⌘ on a Mac) saves, Enter alone is a new line. */
	function keys(e: KeyboardEvent, note: { id: number; text: string }) {
		if (e.key === 'Escape') editing = null;
		else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void save(note);
		}
	}

	/** Into the textarea at once, with the cursor at the end. */
	function focusEnd(el: HTMLTextAreaElement) {
		el.focus();
		el.setSelectionRange(el.value.length, el.value.length);
	}

	// The list: several at once, with commas («leche, pan, huevos»).
	let item = $state('');
	async function add(e: SubmitEvent) {
		e.preventDefault();
		const items = item
			.split(/[,\n]/)
			.map((t) => t.trim())
			.filter(Boolean);
		if (items.length && (await send({ action: 'add', items }))) item = '';
	}

	// «Hoy»: what is over, in grey, as the clock goes; the day itself changes from the server.
	let now = $state(localTime());
	$effect(() => {
		const tick = setInterval(() => (now = localTime()), 30_000);
		return () => clearInterval(tick);
	});
	const today = $derived(dayEvents(fridge.today.events, fridge.today.day));
	const person = (id: string) => fridge.today.people.find((p) => p.id === id);

	const items = $derived(readonly ? fridge.list.items.filter((i) => !i.done) : fridge.list.items);
	const bought = $derived(fridge.list.items.filter((i) => i.done).length);
</script>

{#snippet magnet(color: string)}
	<span
		class="absolute -top-2 left-1/2 h-5 w-5 -translate-x-1/2 rounded-full shadow-md"
		style="background: radial-gradient(circle at 35% 35%, #fff8, transparent 45%), {color}"
		aria-hidden="true"
	></span>
{/snippet}

<div class={['door rounded-2xl p-4 sm:p-6', big && 'p-8']}>
	{#if !readonly}
		<form onsubmit={stick} class="mb-6 flex flex-col gap-2">
			<textarea
				bind:value={text}
				maxlength={MAX_NOTE}
				rows="2"
				placeholder="Escribe un post-it para la casa: «Llamar al fontanero», «La cena está en el horno»…"
				aria-label="Nuevo post-it"
				class="hand w-full resize-none rounded-md border-zinc-300 bg-amber-100 px-3 py-2 text-lg text-amber-950 placeholder:text-amber-900/50"
			></textarea>
			<div class="flex flex-wrap items-center gap-2 text-sm">
				<span class="text-zinc-300">Hasta</span>
				<button
					type="button"
					class={['chip', until === null && 'on']}
					onclick={() => (until = null)}>que se despegue</button
				>
				{#each choices as c (c.value)}
					<button
						type="button"
						class={['chip', until === c.value && 'on']}
						onclick={() => (until = c.value)}>{c.label.toLowerCase()}</button
					>
				{/each}
				<button
					class="ml-auto rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
					disabled={!text.trim()}>Pegar</button
				>
			</div>
		</form>
	{/if}
	{#if problem}
		<p class="mb-4 text-sm text-red-300" role="alert">{problem}</p>
	{/if}

	<!-- On the TV, five to a row and as tall as their words: the rest of the screen is to watch. -->
	<ul class={['grid gap-6', big ? 'grid-cols-5 items-start gap-10' : 'grid-cols-2 sm:grid-cols-3']}>
		<!-- The agenda's «Hoy» (#200): first, a calendar's sheet. Changed in the agenda, not here. -->
		{#if today.length}
			<li
				class={['paper relative', big ? 'col-span-1' : 'col-span-2 sm:col-span-1']}
				style="--bg: #fff; --ink: #1c1917; transform: rotate(1deg)"
			>
				<svelte:element
					this={readonly ? 'div' : 'a'}
					href={readonly ? undefined : `/agenda?dia=${fridge.today.day}`}
					class="block"
				>
					<p
						class={[
							'-mx-4 -mt-5 mb-3 bg-red-600 px-4 pt-4 pb-1 font-bold text-white uppercase',
							big ? 'text-2xl' : 'text-base'
						]}
					>
						Hoy
						<span class="font-normal normal-case opacity-90">· {dayName(fridge.today.day)}</span>
					</p>
					<ul class="flex flex-col gap-1.5">
						{#each today as o (`${o.eventId}-${o.day}`)}
							{@const over = isOver(o, fridge.today.day, now)}
							<li class={['flex items-baseline gap-2', over && 'text-stone-400']}>
								<span class={['shrink-0 font-semibold tabular-nums', big ? 'text-xl' : 'text-sm']}
									>{timeOn(o, fridge.today.day)}</span
								>
								<span class={['hand min-w-0 flex-1 break-words', big ? 'text-2xl' : 'text-lg']}
									>{o.title}</span
								>
								<span class="flex shrink-0 -space-x-1 self-center">
									{#each o.people as id (id)}
										{@const p = person(id)}
										{#if p}
											<span
												title={p.name}
												class={[
													'flex items-center justify-center rounded-full ring-2 ring-white',
													p.color ?? 'bg-stone-300',
													big ? 'h-9 w-9 text-xl' : 'h-6 w-6 text-sm',
													over && 'opacity-50'
												]}>{p.emoji ?? p.name.slice(0, 1)}</span
											>
										{/if}
									{/each}
								</span>
							</li>
						{/each}
					</ul>
				</svelte:element>
				<!-- After the sheet's red top, so it is on it. -->
				{@render magnet('#0f766e')}
			</li>
		{/if}
		<!-- The shopping list: first, a little bigger, on squared paper. -->
		{#if !readonly || items.length}
			<li
				class={[
					'paper list relative',
					big ? 'col-span-1' : 'col-span-2 sm:col-span-1 sm:row-span-2'
				]}
				style="--bg: {LIST_PAPER.bg}; --ink: {LIST_PAPER.ink}; transform: rotate(-1deg)"
			>
				{@render magnet(LIST_PAPER.pin)}
				<h2 class={['hand mb-2 font-bold', big ? 'text-3xl' : 'text-xl']}>🛒 Lista de la compra</h2>
				<ul class="flex flex-col">
					{#each items as i (i.id)}
						<li class="flex items-center gap-2">
							{#if readonly}
								<span class={['hand', big ? 'text-2xl' : 'text-lg']}>· {i.text}</span>
							{:else}
								<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
									<input
										type="checkbox"
										checked={i.done}
										onchange={(e) =>
											send({ action: 'done', id: i.id, done: e.currentTarget.checked })}
										class="h-5 w-5 shrink-0 rounded border-stone-400 text-stone-700"
									/>
									<span class={['hand truncate text-lg', i.done && 'text-stone-400 line-through']}
										>{i.text}</span
									>
								</label>
								<button
									type="button"
									class="shrink-0 px-1 text-stone-400 hover:text-red-600"
									aria-label="Quitar {i.text}"
									onclick={() => send({ action: 'remove', id: i.id })}>✕</button
								>
							{/if}
						</li>
					{:else}
						<li class="hand text-lg text-stone-400">Nada que comprar.</li>
					{/each}
				</ul>
				{#if !readonly}
					<form onsubmit={add} class="mt-3 flex gap-2">
						<input
							bind:value={item}
							maxlength={MAX_ITEM * 5}
							placeholder="Añadir: leche, pan…"
							aria-label="Añadir a la lista"
							class="hand min-w-0 flex-1 rounded border-stone-300 bg-white/70 px-2 py-1 text-lg"
						/>
						<button
							class="rounded bg-stone-700 px-3 text-sm text-white disabled:opacity-40"
							disabled={!item.trim()}>Añadir</button
						>
					</form>
					{#if bought}
						<button
							type="button"
							class="mt-2 text-sm text-stone-500 hover:text-stone-800 hover:underline"
							onclick={() => send({ action: 'clear' })}>Quitar lo comprado ({bought})</button
						>
					{/if}
				{/if}
			</li>
		{/if}

		{#each fridge.notes as note (note.id)}
			{@const paper = PAPERS[note.author?.paper ?? 0]}
			<li
				class={['paper relative flex flex-col', big ? 'min-h-48' : 'aspect-square']}
				style="--bg: {paper.bg}; --ink: {paper.ink}; transform: rotate({tiltFor(note.id)}deg)"
			>
				{@render magnet(paper.pin)}
				{#if editing === note.id}
					<textarea
						bind:value={draft}
						{@attach focusEnd}
						maxlength={MAX_NOTE}
						aria-label="Texto del post-it"
						onkeydown={(e) => keys(e, note)}
						class="hand -mx-1 min-h-0 w-[calc(100%+0.5rem)] flex-1 resize-none rounded-sm border-0 bg-black/5 px-1 py-0 text-xl leading-normal text-inherit focus:ring-2 focus:ring-black/20"
					></textarea>
				{:else if readonly}
					<p
						class={[
							'hand flex-1 overflow-hidden break-words whitespace-pre-line',
							big ? 'text-3xl' : 'text-xl'
						]}
					>
						{note.text}
					</p>
				{:else}
					<!-- Tapped, it is written on there. Flex: a button centres its words, these go on top. -->
					<button
						type="button"
						title="Cambiar el texto"
						class="hand flex flex-1 cursor-text items-start overflow-hidden text-left text-xl break-words whitespace-pre-line"
						onclick={() => edit(note)}>{note.text}</button
					>
				{/if}
				<p class={['mt-2 flex items-end gap-2 opacity-70', big ? 'text-lg' : 'text-xs']}>
					<span class="min-w-0 flex-1 truncate"
						>{note.author?.name ?? ''}{note.until ? ` · ${untilText(note.until)}` : ''}</span
					>
					{#if !readonly}
						{#if editing === note.id}
							<button
								type="button"
								class="font-semibold disabled:opacity-50"
								disabled={saving || !draft.trim()}
								onclick={() => save(note)}>{saving ? 'Guardando…' : 'Guardar'}</button
							>
							<button type="button" onclick={() => (editing = null)}>Cancelar</button>
						{:else if peeling === note.id}
							<button
								type="button"
								class="font-semibold text-red-700"
								onclick={() => send({ action: 'peel', id: note.id })}>Despegar</button
							>
							<button type="button" onclick={() => (peeling = null)}>No</button>
						{:else}
							<button
								type="button"
								class="hover:underline"
								aria-label="Despegar este post-it"
								onclick={() => (peeling = note.id)}>✕</button
							>
						{/if}
					{/if}
				</p>
			</li>
		{/each}
	</ul>
	{#if readonly && !fridge.notes.length && !items.length && !today.length}
		<p class="text-center text-zinc-400">La nevera está vacía.</p>
	{/if}
</div>

<style>
	/* The fridge's door: a light, brushed metal, with the post-its stuck on it. */
	.door {
		background:
			repeating-linear-gradient(90deg, #ffffff06 0 2px, transparent 2px 5px),
			linear-gradient(160deg, #3f3f46, #27272a);
		box-shadow: inset 0 1px 0 #ffffff14;
	}
	.paper {
		background: var(--bg);
		color: var(--ink);
		padding: 1.25rem 1rem 0.75rem;
		box-shadow:
			0 10px 16px -8px #0009,
			0 2px 3px #0004;
		border-radius: 2px;
	}
	/* The list: squared paper, as a notebook's. */
	.list {
		background-image:
			linear-gradient(#0ea5e922 1px, transparent 1px),
			linear-gradient(90deg, #0ea5e922 1px, transparent 1px);
		background-size: 1.25rem 1.25rem;
		background-color: var(--bg);
	}
	.hand {
		font-family: 'Comic Neue', cursive;
	}
	.chip {
		border-radius: 9999px;
		border: 1px solid #52525b;
		padding: 0.125rem 0.75rem;
		color: #d4d4d8;
	}
	.chip:hover {
		background: #3f3f46;
	}
	.chip.on {
		border-color: #f59e0b;
		color: #fbbf24;
	}
</style>
