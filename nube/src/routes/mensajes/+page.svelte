<script lang="ts">
	import { untrack } from 'svelte';
	import { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import { MAX_TEXT } from '#lib/mensajes/messenger.ts';
	import CopiaPin from './CopiaPin.svelte';
	import AudioBurbuja from './AudioBurbuja.svelte';
	import { VoiceRecorder } from '#lib/mensajes/recorder.svelte.ts';
	import MediaIcon from 'comun/components/MediaIcon.svelte';
	import type { PageProps } from './$types';

	/**
	 * Mensajes (#551): the family's conversation and two people's (of the family, or of a linked one),
	 * end-to-end encrypted. This device's keys are made here the first time; what is said is encrypted
	 * and read only in the devices of those in each conversation.
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

	const recorder = new VoiceRecorder();
	/** Held down: recording; let go: sent; slid off the button: dropped. */
	async function release(cancel = false) {
		const got = await recorder.stop(cancel);
		if (got) await client.sendAudio(got.blob, got.seconds);
	}
	const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

	const nameOf = (userId: string) => data.names[userId] ?? 'Alguien';
	const when = (iso: string) =>
		new Date(iso).toLocaleString('es-ES', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
	const familyChat = $derived(client.chats.find((c) => c.kind === 'familia'));
	/** Each person one may write to, with their conversation if there is one. */
	const people = $derived(
		data.contacts
			.map((p) => ({ ...p, chat: client.chats.find((c) => c.with === p.userId) ?? null }))
			.sort((a, b) => (b.chat?.last?.at ?? '').localeCompare(a.chat?.last?.at ?? ''))
	);
	const open = $derived(client.chats.find((c) => c.id === client.current));
	const title = $derived(
		!open ? '' : open.kind === 'familia' ? 'Familia' : open.with ? nameOf(open.with) : ''
	);
	const preview = (
		m: { text: string; mine: boolean; userId: string; audio?: { seconds: number } } | null,
		group: boolean
	) =>
		!m
			? 'Sin mensajes todavía'
			: `${m.mine ? 'Tú: ' : group ? `${nameOf(m.userId)}: ` : ''}${m.audio ? `🎤 Audio (${clock(m.audio.seconds)})` : m.text}`;
</script>

<svelte:head>
	<title>Mensajes · Seilide</title>
</svelte:head>

<div class="mx-auto flex max-w-2xl flex-col">
	{#if client.phase === 'ready' && client.current}
		<div class="mb-3 flex items-center gap-3">
			<button
				class="text-sm text-zinc-400 hover:text-white"
				onclick={() => void client.select(null)}>← Volver</button
			>
			<h1 class="min-w-0 flex-1 truncate text-xl font-bold">{title}</h1>
		</div>
	{:else}
		<h1 class="mb-1 text-2xl font-bold">Mensajes</h1>
		<p class="mb-4 text-sm text-zinc-400">
			🔒 Cifrados de extremo a extremo: solo los leen los aparatos de quienes están en cada
			conversación. Seilide los reparte sin poder leerlos.
		</p>
	{/if}

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
				Se crean aquí sus llaves, que no salen de este aparato. Lo de antes de activarlo, con tu PIN
				si tienes copia.
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
	{:else if !client.current}
		<CopiaPin {client} />
		<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
			{#if familyChat}
				<li>
					<button
						class="flex w-full items-center gap-3 p-3 text-left hover:bg-zinc-900"
						onclick={() => void client.select(familyChat.id)}
					>
						<span class="text-2xl" aria-hidden="true">🏠</span>
						<span class="min-w-0 flex-1">
							<span class="block font-semibold">Familia</span>
							<span class="block truncate text-sm text-zinc-400"
								>{preview(familyChat.last, true)}</span
							>
						</span>
						{#if familyChat.unread}<span
								class="h-2.5 w-2.5 rounded-full bg-amber-500"
								aria-label="Sin leer"
							></span>{/if}
					</button>
				</li>
			{/if}
			{#each people as p (p.userId)}
				<li>
					<button
						class="flex w-full items-center gap-3 p-3 text-left hover:bg-zinc-900"
						onclick={() => void (p.chat ? client.select(p.chat.id) : client.openWith(p.userId))}
					>
						<span
							class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold"
							aria-hidden="true">{p.name.slice(0, 1)}</span
						>
						<span class="min-w-0 flex-1">
							<span class="block font-semibold"
								>{p.name}{#if p.family}<span class="font-normal text-zinc-500">
										· {p.family}</span
									>{/if}</span
							>
							<span class="block truncate text-sm text-zinc-400"
								>{preview(p.chat?.last ?? null, false)}</span
							>
						</span>
						{#if p.chat?.unread}<span
								class="h-2.5 w-2.5 rounded-full bg-amber-500"
								aria-label="Sin leer"
							></span>{/if}
					</button>
				</li>
			{/each}
		</ul>
		{#if client.problem}
			<p class="mt-2 text-sm text-red-400">{client.problem}</p>
		{/if}
	{:else}
		<div
			bind:this={list}
			class="mb-3 flex max-h-[60vh] min-h-48 flex-col gap-2 overflow-y-auto rounded-md border border-zinc-800 p-3"
			aria-live="polite"
		>
			{#each client.list as m (m.key)}
				<div class={['flex flex-col', m.mine ? 'items-end' : 'items-start']}>
					<div
						class={[
							'max-w-[85%] rounded-2xl px-3 py-2 break-words',
							!m.audio && 'whitespace-pre-wrap',
							m.mine ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-100'
						]}
					>
						{#if m.audio}<AudioBurbuja {m} {client} />{:else}{m.text}{/if}
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
				Entrando en la conversación… Otro aparato que tenga Mensajes abierto te da entrada en unos
				segundos; si no hay ninguno, en cuanto alguien lo abra.
			</p>
		{:else if client.alone}
			<p class="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
				{open?.kind === 'familia'
					? 'Todavía no hay nadie más de la familia con los mensajes activados.'
					: `${title} todavía no tiene los mensajes activados.`} Cuando los active, verá lo que escribas
				desde entonces; lo de antes, solo tus aparatos.
			</p>
		{/if}
		<form class="flex gap-2" onsubmit={send}>
			<input
				bind:value={text}
				maxlength={MAX_TEXT}
				placeholder={open?.kind === 'familia' ? 'Escribe a la familia' : `Escribe a ${title}`}
				aria-label="Mensaje"
				class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-900"
			/>
			{#if text.trim()}
				<button
					class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
					disabled={sending || client.waiting}>Enviar</button
				>
			{:else}
				<!-- Held down to record a voice note; let go to send it; slid off, dropped. -->
				<button
					type="button"
					class={[
						'flex touch-none items-center gap-2 rounded-md px-4 py-2 font-medium select-none disabled:opacity-50',
						recorder.recording
							? 'bg-red-600 text-white'
							: 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
					]}
					aria-label="Mantén pulsado para grabar un audio"
					disabled={client.waiting}
					onpointerdown={(e) => {
						e.currentTarget.setPointerCapture(e.pointerId);
						void recorder.start();
					}}
					onpointerup={() => void release()}
					onpointercancel={() => void release(true)}
					oncontextmenu={(e) => e.preventDefault()}
					><MediaIcon name="mic" class="h-5 w-5" />{#if recorder.recording}<span
							class="font-mono tabular-nums">{clock(recorder.seconds)}</span
						>{/if}</button
				>
			{/if}
		</form>
		{#if recorder.recording}
			<p class="mt-2 text-sm text-red-400" role="status">● Grabando… suelta para enviarlo</p>
		{:else if recorder.problem}
			<p class="mt-2 text-sm text-red-400">{recorder.problem}</p>
		{/if}
		{#if client.problem}
			<p class="mt-2 text-sm text-red-400">{client.problem}</p>
		{/if}
	{/if}
</div>
