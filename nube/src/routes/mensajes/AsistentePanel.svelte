<script lang="ts">
	import ChatRecipeCard from '#lib/components/ChatRecipeCard.svelte';
	import CitaCard from '#lib/components/CitaCard.svelte';
	import SitioCard from './SitioCard.svelte';
	import type { ChatCard } from '#lib/chat.ts';
	import { bookRecipeCard, type MessageCard } from '#lib/mensajes/messenger.ts';

	/**
	 * Mensajes (#555): the AI's panel beside a conversation, by the family's wake word («Makoto»).
	 * Only this person sees it, and the AI only what is written here, never the conversation. It
	 * answers with cards (a recipe, a list); one is sent with «Enviar». Its turns live here only, and
	 * are sent with each question.
	 */
	let {
		name,
		to,
		request,
		sameFamily,
		onsend,
		onclose
	}: {
		/** The AI's name: «Makoto». */
		name: string;
		/** Whom the conversation is with: «la familia», «Papá». */
		to: string;
		/**
		 * What was asked from the box below («@makoto…»), asked at once: each time a new one, also
		 * with the panel open (its turns stay).
		 */
		request: { first: string | null };
		/** With someone of the family: a recipe of the book goes as a link, not copied. */
		sameFamily: boolean;
		onsend: (card: MessageCard) => Promise<boolean>;
		onclose: () => void;
	} = $props();

	type Turn = { role: 'user' | 'assistant'; text: string; cards: ChatCard[] };
	let turns = $state<Turn[]>([]);
	let question = $state('');
	let asking = $state(false);
	let problem = $state<string | null>(null);
	let sending = $state<string | null>(null);
	let box = $state<HTMLElement>();

	async function ask(said: string) {
		const clean = said.trim();
		if (!clean || asking) return;
		problem = null;
		asking = true;
		const before = $state.snapshot(turns) as Turn[];
		turns.push({ role: 'user', text: clean, cards: [] });
		question = '';
		try {
			const res = await fetch('/api/mensajes/ia', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ question: clean, to, assistant: name, turns: before })
			});
			const answer = await res.json().catch(() => null);
			if (!res.ok) throw new Error(answer?.message ?? 'Sin conexión');
			turns.push({ role: 'assistant', text: answer.text ?? '', cards: answer.cards ?? [] });
		} catch (err) {
			turns.pop();
			question = clean;
			problem = err instanceof Error ? err.message : String(err);
		} finally {
			asking = false;
		}
	}

	// What came from the box below, once each.
	let seen: object | null = null;
	$effect(() => {
		const r = request;
		if (r === seen) return;
		seen = r;
		if (r.first) void ask(r.first);
	});

	// Where the latest question starts, so its answer reads from the top (the cards are long).
	$effect(() => {
		void turns.length;
		void asking;
		const asked = box?.querySelectorAll<HTMLElement>('[data-asked]');
		const last = asked?.[asked.length - 1];
		if (box && last) box.scrollTo({ top: last.offsetTop - box.offsetTop - 4 });
	});

	/** Only a recipe or a list may go in a message. */
	const sendable = (c: ChatCard): MessageCard | null =>
		c.kind === 'receta'
			? c.savedId
				? bookRecipeCard({ id: c.savedId, recipe: c.recipe }, sameFamily)
				: { kind: 'receta', recipe: c.recipe }
			: c.kind === 'compra'
				? { kind: 'compra', items: c.items }
				: c.kind === 'cita' || c.kind === 'sitio'
					? c
					: null;

	async function send(card: MessageCard, id: string) {
		sending = id;
		const ok = await onsend(card);
		sending = null;
		if (ok) onclose();
	}
</script>

<section
	class="mb-3 rounded-md border border-violet-500/40 bg-violet-950/30 p-3"
	aria-label="Pedir a {name}"
>
	<div class="mb-2 flex items-center gap-2">
		<h2 class="flex-1 font-semibold">✨ {name}</h2>
		<button class="text-sm text-zinc-400 hover:text-white" onclick={onclose}>✕ Cerrar</button>
	</div>
	<p class="mb-2 text-xs text-zinc-400">
		Solo lo ves tú. {name} no lee este chat: solo lo que le pidas aquí. Elige una tarjeta y se manda a
		{to}.
	</p>
	<div
		bind:this={box}
		class="relative flex max-h-[50vh] flex-col gap-2 overflow-y-auto"
		aria-live="polite"
	>
		{#each turns as t, ti (ti)}
			{#if t.role === 'user'}
				<p data-asked class="self-end rounded-2xl bg-violet-600/60 px-3 py-1.5 text-sm">{t.text}</p>
			{:else}
				{#if t.text}<p class="text-sm whitespace-pre-wrap text-zinc-200">{t.text}</p>{/if}
				{#each t.cards as c, ci (ci)}
					{@const card = sendable(c)}
					{#if card && c.kind === 'receta'}
						<ChatRecipeCard card={c}>
							{#snippet actions()}
								<button
									class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
									disabled={sending !== null}
									onclick={() => send(card, `${ti}/${ci}`)}
									>{sending === `${ti}/${ci}` ? 'Enviando…' : 'Enviar esta'}</button
								>
								{#if c.savedId}
									<span class="text-xs text-zinc-400"
										>{card.kind === 'enlace-receta'
											? 'Está en vuestro recetario: se manda el enlace'
											: 'Del recetario: se manda entera, para que la guarden'}</span
									>
								{/if}
							{/snippet}
						</ChatRecipeCard>
					{:else if card && c.kind === 'cita'}
						<CitaCard cita={c}>
							<button
								class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
								disabled={sending !== null}
								onclick={() => send(card, `${ti}/${ci}`)}
								>{sending === `${ti}/${ci}` ? 'Enviando…' : 'Enviar esta'}</button
							>
						</CitaCard>
					{:else if card && c.kind === 'sitio'}
						<SitioCard place={c}>
							<button
								class="rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
								disabled={sending !== null}
								onclick={() => send(card, `${ti}/${ci}`)}
								>{sending === `${ti}/${ci}` ? 'Enviando…' : 'Enviar este'}</button
							>
						</SitioCard>
					{:else if card && c.kind === 'compra'}
						<div class="rounded-xl border border-zinc-700 bg-zinc-900/80 p-3">
							<p class="mb-1 text-sm font-semibold text-zinc-300">🛒 Lista</p>
							<ul class="list-disc pl-5 text-zinc-300">
								{#each c.items as item (item)}<li>{item}</li>{/each}
							</ul>
							<button
								class="mt-3 rounded-md bg-amber-500 px-4 py-1.5 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
								disabled={sending !== null}
								onclick={() => send(card, `${ti}/${ci}`)}
								>{sending === `${ti}/${ci}` ? 'Enviando…' : 'Enviar la lista'}</button
							>
						</div>
					{/if}
				{/each}
			{/if}
		{/each}
		{#if asking}
			<p class="text-sm text-zinc-400" role="status">✨ {name} está buscando…</p>
		{/if}
	</div>
	{#if problem}<p class="mt-2 text-sm text-red-400">{problem}</p>{/if}
	<form
		class="mt-2 flex gap-2"
		onsubmit={(e) => {
			e.preventDefault();
			void ask(question);
		}}
	>
		<input
			bind:value={question}
			maxlength="2000"
			placeholder={turns.length ? 'Pídele otra cosa…' : 'Búscame la receta de…'}
			aria-label="Lo que pides a {name}"
			class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900"
		/>
		<button
			class="rounded-md bg-violet-500 px-4 py-2 font-medium text-white hover:bg-violet-400 disabled:opacity-50"
			disabled={asking || !question.trim()}>Pedir</button
		>
	</form>
</section>
