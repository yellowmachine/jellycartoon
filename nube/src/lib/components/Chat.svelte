<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, refreshAll } from '$app/navigation';
	import BarsBlock from '#lib/components/BarsBlock.svelte';
	import { tick, type Snippet } from 'svelte';
	import Caracol from '#lib/components/Caracol.svelte';
	import ChatRecipeCard from '#lib/components/ChatRecipeCard.svelte';
	import EncargosCard from '#lib/components/EncargosCard.svelte';
	import CambioEncargoCard from '#lib/components/CambioEncargoCard.svelte';
	import PausaEnchufeCard from '#lib/components/PausaEnchufeCard.svelte';
	import DeseoCard from '#lib/components/DeseoCard.svelte';
	import SaltarHorarioCard from '#lib/components/SaltarHorarioCard.svelte';
	import ShoppingCard from '#lib/components/ShoppingCard.svelte';
	import { firstRead, MAX_CHAT_QUESTION, type ChatMessage } from '#lib/chat.ts';

	/**
	 * «Preguntar» (#470): a chat with the family's AI, each person their own. Its answers bring cards
	 * (things to buy, a recipe) that do something only when tapped. Its page and the side panel
	 * beside any page (#504) show this same chat: every form goes to /preguntar's actions, and what
	 * they answer updates it here, so the page around it stays where it is. `path`, in the panel: the
	 * page it is beside, for the AI to know which section the question is about; and where a page the
	 * AI opens shows, by itself, in the main part (#504 phase 3; «Atrás» goes back). `over`, in the
	 * phone's sheet, which covers that page: nothing opens by itself, the card takes there, and for the
	 * page already under it, `over` closes the sheet.
	 */
	let {
		messages: initial,
		toBuy: initialToBuy,
		hasAi,
		path = null,
		compact = false,
		over,
		heading
	}: {
		messages: ChatMessage[];
		toBuy: string[];
		hasAi: boolean;
		path?: string | null;
		/** The panel: smaller, and its examples shorter. */
		compact?: boolean;
		/** The phone's sheet, over the page: closes it. */
		over?: () => void;
		/** Before «Empezar de nuevo»: the page's title, or the panel's buttons. */
		heading?: Snippet;
	} = $props();

	// Its own copies, changed by what the actions answer.
	let messages = $derived(initial);
	let toBuy = $derived(initialToBuy);

	let question = $state('');
	/** What was just sent, shown while the AI answers. */
	let pending = $state<string | null>(null);
	let problem = $state<string | null>(null);
	let confirmClear = $state(false);
	let bottom: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();

	const toBottom = async () => {
		await tick();
		bottom?.scrollIntoView({ block: 'end' });
	};

	$effect(() => {
		void messages.length;
		void pending;
		void toBottom();
	});

	/**
	 * What the AI no longer reads (over 2 hours, or before its last 20): dimmed above a line. The
	 * clock moves it every minute, and each question sent.
	 */
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(id);
	});
	const cut = $derived(firstRead(messages, now));

	const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

	const EXAMPLES = [
		'Quiero empezar con repostería: tengo horno y una bandeja de cristal. ¿Qué compro?',
		'¿Qué ceno hoy con lo que suele haber en casa?',
		'Hazme la receta de unas lentejas para cuatro'
	];

	/** A card changed by its action: its message, with that card as it is now. */
	function setCard(
		messageId: number,
		index: number,
		change: (card: ChatMessage['cards'][number]) => ChatMessage['cards'][number]
	) {
		messages = messages.map((m) =>
			m.id === messageId ? { ...m, cards: m.cards.map((c, i) => (i === index ? change(c) : c)) } : m
		);
	}
</script>

<!-- In the panel, as tall as it: its title at the top and the box to write in at its foot, as in any chat. -->
<div class={['flex flex-col', compact && 'flex-1']}>
	<header
		class={[
			'flex flex-wrap items-center gap-2',
			heading ? 'justify-between' : 'justify-end',
			// In the panel, always at the top: the conversation scrolls under it.
			compact ? 'sticky top-0 z-10 mb-2 bg-zinc-950 pt-4 pb-2' : heading ? 'mb-4' : 'mb-2'
		]}
	>
		{@render heading?.()}
		{#if messages.length}
			{#if confirmClear}
				<form
					method="post"
					action="/preguntar?/clear"
					class="flex items-center gap-2"
					use:enhance={() => {
						confirmClear = false;
						return ({ result }) => {
							if (result.type === 'success') messages = [];
						};
					}}
				>
					<span class="text-sm text-zinc-400">¿Borrar toda la conversación?</span>
					<button class="rounded-md bg-red-600 px-3 py-1 text-sm text-claro hover:bg-red-500"
						>Borrar</button
					>
					<button
						type="button"
						class="rounded-md px-3 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
						onclick={() => (confirmClear = false)}>No</button
					>
				</form>
			{:else}
				<button
					class="rounded-md px-3 py-1 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white"
					onclick={() => (confirmClear = true)}>Empezar de nuevo</button
				>
			{/if}
		{/if}
	</header>

	{#if !hasAi}
		<p class="rounded-lg bg-zinc-900 p-4 text-zinc-300">
			Para preguntar hace falta la clave de IA de la familia: quien administra la pone en
			<a href="/ajustes" class="text-amber-400 hover:underline">Ajustes</a>.
		</p>
	{:else}
		{#if !messages.length && !pending}
			<div class="mb-6 text-zinc-400">
				<p class={compact ? 'text-sm' : ''}>
					Pregunta lo que quieras. Si hace falta comprar algo o hay una receta, te la preparo para
					que la añadas a la lista o la guardes con un toque. Lo que hablamos solo lo ves tú y se
					borra a los 30 días; lo que guardes (la lista, las recetas, los informes) se queda.
				</p>
				<div class="mt-4 flex flex-col gap-2">
					{#each EXAMPLES as example (example)}
						<button
							class="rounded-lg border border-zinc-800 px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-900"
							onclick={() => {
								question = example;
								input?.focus();
							}}>{example}</button
						>
					{/each}
				</div>
			</div>
		{/if}

		<ol class={['flex flex-col gap-4', compact && 'text-sm']}>
			{#each messages as m, n (m.id)}
				{#if n === cut && n > 0}
					<li role="separator" class="flex items-center gap-2 text-xs text-zinc-500">
						<span class="h-px flex-1 bg-zinc-800"></span>
						Lo de arriba ya no lo tiene en cuenta la IA
						<span class="h-px flex-1 bg-zinc-800"></span>
					</li>
				{/if}
				<li class={[m.role === 'user' && 'flex justify-end', n < cut && 'opacity-50']}>
					{#if m.role === 'user'}
						<div
							class="max-w-[85%] rounded-2xl rounded-br-sm bg-amber-500/15 px-3 py-2 whitespace-pre-line text-zinc-100"
							title={time.format(new Date(m.createdAt))}
						>
							{m.text}
						</div>
					{:else}
						<div class="min-w-0">
							{#if m.text}<p class="whitespace-pre-line text-zinc-200">{m.text}</p>{/if}
							{#each m.cards as card, i (i)}
								{#if card.kind === 'compra'}
									<ShoppingCard
										items={card.items}
										added={card.added}
										{toBuy}
										action="/preguntar?/add"
										refresh={false}
										onadded={(data) => {
											const added = Array.isArray(data?.added) ? data.added.map(String) : [];
											setCard(m.id, i, (c) =>
												c.kind === 'compra'
													? { ...c, added: [...new Set([...(c.added ?? []), ...added])] }
													: c
											);
											toBuy = [...new Set([...toBuy, ...added])];
											// The page beside it read again, without moving: the shopping list shows them.
											void refreshAll();
										}}
									>
										<input type="hidden" name="message" value={m.id} />
										<input type="hidden" name="card" value={i} />
									</ShoppingCard>
								{:else if card.kind === 'pagina'}
									<a
										href={card.href}
										onclick={(e) => {
											if (!over || path !== card.href) return;
											e.preventDefault();
											over();
										}}
										class="mt-2 flex items-center justify-between gap-2 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-zinc-200 hover:border-amber-500/60 hover:bg-zinc-900"
									>
										<span class="min-w-0 truncate">{card.label}</span>
										<span class="shrink-0 text-sm text-amber-400"
											>{path === card.href && !over ? 'Abierta al lado' : 'Ver →'}</span
										>
									</a>
								{:else if card.kind === 'bloque'}
									<BarsBlock block={card.block} />
								{:else if card.kind === 'informe'}
									<a
										href="/preguntar/informes/{card.id}"
										class="mt-2 flex items-center justify-between gap-2 rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-zinc-200 hover:border-amber-500/60 hover:bg-zinc-900"
									>
										<span class="min-w-0">
											<span class="block truncate">📄 {card.title}</span>
											<span class="block text-xs text-zinc-500">Guardado en Informes</span>
										</span>
										<span class="shrink-0 text-sm text-amber-400">Abrir →</span>
									</a>
								{:else if card.kind === 'encargos'}
									<EncargosCard
										{card}
										message={m.id}
										index={i}
										onsaved={(saved) => setCard(m.id, i, () => saved)}
									/>
								{:else if card.kind === 'cambio-encargo'}
									<CambioEncargoCard
										{card}
										message={m.id}
										index={i}
										ondone={(done) => setCard(m.id, i, () => done)}
									/>
								{:else if card.kind === 'pausa-enchufe'}
									<PausaEnchufeCard
										{card}
										message={m.id}
										index={i}
										ondone={(done) => setCard(m.id, i, () => done)}
									/>
								{:else if card.kind === 'deseo'}
									<DeseoCard
										{card}
										message={m.id}
										index={i}
										ondone={(done) => setCard(m.id, i, () => done)}
									/>
								{:else if card.kind === 'saltar-horario'}
									<SaltarHorarioCard
										{card}
										message={m.id}
										index={i}
										ondone={(done) => setCard(m.id, i, () => done)}
									/>
								{:else if card.kind === 'receta'}
									<!-- A plan (`cita`) is only made in Mensajes' panel (#555). -->
									<ChatRecipeCard
										{card}
										message={m.id}
										index={i}
										onsaved={(savedId) =>
											setCard(m.id, i, (c) => (c.kind === 'receta' ? { ...c, savedId } : c))}
									/>
								{/if}
							{/each}
						</div>
					{/if}
				</li>
			{/each}
			{#if messages.length && cut === messages.length}
				<li role="separator" class="flex items-center gap-2 text-xs text-zinc-500">
					<span class="h-px flex-1 bg-zinc-800"></span>
					La IA empieza de cero: lo de arriba es solo para ti
					<span class="h-px flex-1 bg-zinc-800"></span>
				</li>
			{/if}
			{#if pending}
				<li class="flex justify-end">
					<div
						class="max-w-[85%] rounded-2xl rounded-br-sm bg-amber-500/15 px-3 py-2 whitespace-pre-line text-zinc-100"
					>
						{pending}
					</div>
				</li>
				<li class="flex items-center gap-2 text-sm text-zinc-500">
					<Caracol modo="reptar" class="w-10 text-emerald-500" /> Pensando…
				</li>
			{/if}
		</ol>

		{#if problem}
			<p class="mt-4 text-sm text-red-400">{problem}</p>
		{/if}

		<form
			method="post"
			action="/preguntar?/ask"
			class={[
				'sticky bottom-0 flex items-end gap-2 bg-zinc-950 py-3',
				compact ? 'mt-auto pt-6' : 'mt-6'
			]}
			use:enhance={({ formData, cancel }) => {
				const said = String(formData.get('question') ?? '').trim();
				if (!said || pending) return cancel();
				pending = said;
				problem = null;
				question = '';
				// Not update(): from another page it would take there (Kit 3).
				return async ({ result }) => {
					pending = null;
					now = Date.now();
					if (result.type === 'success' && Array.isArray(result.data?.messages)) {
						const added = result.data.messages as ChatMessage[];
						// Read again meanwhile (the sheet closed and opened), they may be here already.
						messages = [...messages.filter((m) => !added.some((a) => a.id === m.id)), ...added];
						// In the panel, the page it opened shows beside it (the last, if several).
						const opened = added.flatMap((m) => m.cards).findLast((c) => c.kind === 'pagina');
						if (path && !over && opened?.kind === 'pagina') void goto(opened.href);
						return;
					}
					question = said;
					problem =
						result.type === 'failure' && typeof result.data?.message === 'string'
							? result.data.message
							: 'No se pudo preguntar. Prueba otra vez.';
				};
			}}
		>
			{#if path}<input type="hidden" name="path" value={path} />{/if}
			<textarea
				bind:this={input}
				bind:value={question}
				name="question"
				rows="2"
				maxlength={MAX_CHAT_QUESTION}
				placeholder="Escribe tu pregunta…"
				class="min-w-0 flex-1 resize-none rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
				onkeydown={(e) => {
					// Enter sends on a computer; on a phone's keyboard it is a new line.
					if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) {
						e.preventDefault();
						e.currentTarget.form?.requestSubmit();
					}
				}}></textarea>
			<button
				class="rounded-lg bg-amber-500 px-4 py-2 font-semibold text-zinc-950 hover:bg-amber-400 disabled:opacity-40"
				disabled={!question.trim() || Boolean(pending)}>Enviar</button
			>
		</form>
	{/if}
	<div bind:this={bottom}></div>
</div>
