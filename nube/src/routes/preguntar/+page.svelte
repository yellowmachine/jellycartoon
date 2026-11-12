<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import Caracol from '#lib/components/Caracol.svelte';
	import { MAX_CHAT_QUESTION } from '#lib/chat.ts';
	import type { PageProps } from './$types';
	import RecipeCard from './RecipeCard.svelte';
	import ShoppingCard from '#lib/components/ShoppingCard.svelte';

	/**
	 * «Preguntar» (#470): a chat with the family's AI, each person their own. Its answers bring cards
	 * (things to buy, a recipe) that do something only when tapped.
	 */
	let { data, form }: PageProps = $props();

	let question = $state('');
	/** What was just sent, shown while the AI answers. */
	let pending = $state<string | null>(null);
	let confirmClear = $state(false);
	let bottom: HTMLElement | undefined = $state();
	let input: HTMLTextAreaElement | undefined = $state();

	const toBottom = async () => {
		await tick();
		bottom?.scrollIntoView({ block: 'end' });
	};

	$effect(() => {
		void data.messages.length;
		void pending;
		void toBottom();
	});

	const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

	const EXAMPLES = [
		'Quiero empezar con repostería: tengo horno y una bandeja de cristal. ¿Qué compro?',
		'¿Qué ceno hoy con lo que suele haber en casa?',
		'Hazme la receta de unas lentejas para cuatro'
	];
</script>

<svelte:head>
	<title>Preguntar · Seilide</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col">
	<header class="mb-4 flex flex-wrap items-center justify-between gap-2">
		<h1 class="text-2xl font-bold">Preguntar</h1>
		{#if data.messages.length}
			{#if confirmClear}
				<form
					method="post"
					action="?/clear"
					class="flex items-center gap-2"
					use:enhance={() => {
						confirmClear = false;
						return ({ update }) => update();
					}}
				>
					<span class="text-sm text-zinc-400">¿Borrar toda la conversación?</span>
					<button class="rounded-md bg-red-600 px-3 py-1 text-sm text-white hover:bg-red-500"
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

	{#if !data.hasAi}
		<p class="rounded-lg bg-zinc-900 p-4 text-zinc-300">
			Para preguntar hace falta la clave de IA de la familia: quien administra la pone en
			<a href="/ajustes" class="text-amber-400 hover:underline">Ajustes</a>.
		</p>
	{:else}
		{#if !data.messages.length && !pending}
			<div class="mb-6 text-zinc-400">
				<p>
					Pregunta lo que quieras. Si hace falta comprar algo o hay una receta, te la preparo para
					que la añadas a la lista o la guardes con un toque. Lo que hablamos solo lo ves tú.
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

		<ol class="flex flex-col gap-4">
			{#each data.messages as m (m.id)}
				<li class={m.role === 'user' ? 'flex justify-end' : ''}>
					{#if m.role === 'user'}
						<div
							class="max-w-[85%] rounded-2xl rounded-br-sm bg-amber-500/15 px-3 py-2 whitespace-pre-line text-zinc-100"
							title={time.format(m.createdAt)}
						>
							{m.text}
						</div>
					{:else}
						<div class="min-w-0">
							{#if m.text}<p class="whitespace-pre-line text-zinc-200">{m.text}</p>{/if}
							{#each m.cards as card, i (i)}
								{#if card.kind === 'compra'}
									<ShoppingCard items={card.items} added={card.added} toBuy={data.toBuy}>
										<input type="hidden" name="message" value={m.id} />
										<input type="hidden" name="card" value={i} />
									</ShoppingCard>
								{:else}
									<RecipeCard {card} message={m.id} index={i} />
								{/if}
							{/each}
						</div>
					{/if}
				</li>
			{/each}
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

		{#if form && 'question' in form && form.message}
			<p class="mt-4 text-sm text-red-400">{form.message}</p>
		{/if}

		<form
			method="post"
			action="?/ask"
			class="sticky bottom-0 mt-6 flex items-end gap-2 bg-zinc-950 py-3"
			use:enhance={({ formData, cancel }) => {
				const said = String(formData.get('question') ?? '').trim();
				if (!said || pending) return cancel();
				pending = said;
				question = '';
				return async ({ result, update }) => {
					await update({ reset: false });
					if (result.type === 'failure') question = said;
					pending = null;
				};
			}}
		>
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
