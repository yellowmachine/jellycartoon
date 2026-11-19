<script lang="ts">
	import { untrack } from 'svelte';
	import { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import { MAX_TEXT } from '#lib/mensajes/messenger.ts';
	import CopiaPin from './CopiaPin.svelte';
	import type { PageProps } from './$types';

	/**
	 * Mensajes (#551): the family's conversation, end-to-end encrypted. This device's keys are made
	 * here the first time; what is said is encrypted and read only in the family's devices.
	 */
	let { data }: PageProps = $props();

	// The person does not change while the page is open.
	const client = new MessagesClient(untrack(() => data.userId));
	$effect(() => {
		void client.start();
		return () => client.stop();
	});

	/** A guess for this device's name, to change. */
	const guess = /tablet|ipad/i.test(navigator.userAgent)
		? 'Tablet'
		: /mobi|android/i.test(navigator.userAgent)
			? 'Móvil'
			: 'Ordenador';
	let name = $state(guess);
	let text = $state('');
	let sending = $state(false);
	let list = $state<HTMLElement>();

	$effect(() => {
		void client.list.length;
		list?.scrollTo({ top: list.scrollHeight });
	});

	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim() || sending) return;
		sending = true;
		await client.send(text);
		text = '';
		sending = false;
	}

	const nameOf = (userId: string) => data.names[userId] ?? 'Alguien';
	const when = (iso: string) =>
		new Date(iso).toLocaleString('es-ES', {
			weekday: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
</script>

<svelte:head>
	<title>Mensajes · Seilide</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col">
	<h1 class="mb-1 text-2xl font-bold">Mensajes</h1>
	<p class="mb-4 text-sm text-zinc-400">
		🔒 Cifrados de extremo a extremo: solo los leen los aparatos de la familia. Seilide los reparte
		sin poder leerlos.
	</p>

	{#if client.phase === 'loading'}
		<p class="text-zinc-400" role="status">Preparando los mensajes…</p>
	{:else if client.phase === 'off'}
		<form
			class="rounded-md border border-zinc-800 p-4"
			onsubmit={(e) => {
				e.preventDefault();
				void client.turnOn(name);
			}}
		>
			{#if client.problem}
				<p class="mb-3 text-sm text-amber-300">{client.problem}</p>
			{/if}
			<h2 class="mb-1 font-semibold">Activar los mensajes en este aparato</h2>
			<p class="mb-3 text-sm text-zinc-400">
				Se crean aquí sus llaves, que no salen de este aparato. Los mensajes de antes de activarlo
				no se ven aquí.
			</p>
			<label class="mb-3 block text-sm">
				Nombre de este aparato
				<input
					bind:value={name}
					maxlength="60"
					class="mt-1 block w-full max-w-xs rounded-md border-zinc-700 bg-zinc-900"
				/>
			</label>
			<button class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400"
				>Activar</button
			>
		</form>
	{:else if client.phase === 'failed'}
		<p class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
			No se han podido abrir los mensajes: {client.problem}
		</p>
	{:else}
		<CopiaPin {client} />
		<div
			bind:this={list}
			class="mb-3 flex max-h-[60vh] min-h-48 flex-col gap-2 overflow-y-auto rounded-md border border-zinc-800 p-3"
			aria-live="polite"
		>
			{#each client.list as m (m.key)}
				<div class={['flex flex-col', m.mine ? 'items-end' : 'items-start']}>
					<div
						class={[
							'max-w-[85%] rounded-2xl px-3 py-2 break-words whitespace-pre-wrap',
							m.mine ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-100'
						]}
					>
						{m.text}
					</div>
					<span class="mt-0.5 text-xs text-zinc-500"
						>{m.mine ? 'Tú' : nameOf(m.userId)} · {when(m.at)}</span
					>
				</div>
			{:else}
				<p class="m-auto text-sm text-zinc-500">Todavía no hay mensajes. Escribe el primero.</p>
			{/each}
		</div>
		{#if client.waiting}
			<p class="mb-3 rounded-md border border-sky-500/40 bg-sky-500/10 p-3 text-sm" role="status">
				Entrando en la conversación… Otro aparato de la familia que tenga Mensajes abierto te da
				entrada en unos segundos; si no hay ninguno, en cuanto alguien lo abra.
			</p>
		{:else if client.alone}
			<p class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				Todavía no hay nadie más de la familia con los mensajes activados. Cuando lo activen, verán
				lo que escribas desde entonces; lo de antes, solo tus aparatos.
			</p>
		{/if}
		<form class="flex gap-2" onsubmit={send}>
			<input
				bind:value={text}
				maxlength={MAX_TEXT}
				placeholder="Escribe a la familia"
				aria-label="Mensaje"
				class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900"
			/>
			<button
				class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
				disabled={sending || !text.trim() || client.waiting}>Enviar</button
			>
		</form>
		{#if client.problem}
			<p class="mt-2 text-sm text-red-400">{client.problem}</p>
		{/if}
	{/if}
</div>
