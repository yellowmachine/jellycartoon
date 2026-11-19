<script lang="ts">
	import { untrack } from 'svelte';
	import { MessagesClient } from '#lib/mensajes/client.svelte.ts';
	import { MAX_TEXT, describe, type Place, type StoredMessage } from '#lib/mensajes/messenger.ts';
	import { herePosition, shrinkPhoto } from '#lib/mensajes/photo.ts';
	import CopiaPin from './CopiaPin.svelte';
	import AudioBurbuja from './AudioBurbuja.svelte';
	import FotoBurbuja from './FotoBurbuja.svelte';
	import UbicacionBurbuja from './UbicacionBurbuja.svelte';
	import TarjetaBurbuja from './TarjetaBurbuja.svelte';
	import AsistentePanel from './AsistentePanel.svelte';
	import { askedOf, assistantName, completed } from '#lib/mensajes/mention.ts';
	import { bookRecipeCard } from '#lib/mensajes/messenger.ts';
	import { replaceState } from '$app/navigation';
	import { wakeWord } from '#lib/wake-word.svelte.ts';
	import PlacesMap from '#lib/components/PlacesMap.svelte';
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

	/**
	 * The AI's panel (#555), called by the family's wake word: «@makoto…» or «Makoto, …» in the box,
	 * or ✨ in the «+». Only with the family's AI; children have no Mensajes.
	 */
	const aiName = $derived(assistantName(wakeWord.word));
	/** Open: what it was asked from the box (null, opened empty from the «+»). */
	let panel = $state<{ first: string | null } | null>(null);
	const forAi = $derived(data.hasAi ? askedOf(text, aiName) : null);
	const finished = $derived(data.hasAi ? completed(text, aiName) : null);
	let box = $state<HTMLInputElement>();
	// Another conversation, another panel.
	$effect(() => {
		void client.current;
		panel = null;
	});

	async function send(e: SubmitEvent) {
		e.preventDefault();
		if (!text.trim() || sending) return;
		if (forAi !== null) {
			panel = { first: forAi || null };
			text = '';
			return;
		}
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

	/**
	 * The «+» beside the text (#555): a photo or where one is, each seen before it goes (WhatsApp's
	 * way), so nothing is sent by a slip of the finger.
	 */
	let menu = $state(false);
	let menuBox = $state<HTMLElement>();
	let picker = $state<HTMLInputElement>();
	let attaching = $state<
		| { kind: 'foto'; blob: Blob; width: number; height: number; url: string }
		| { kind: 'ubicacion'; place: Place }
		| { kind: 'buscando' }
		| null
	>(null);
	let attachProblem = $state<string | null>(null);

	function dropAttachment() {
		if (attaching?.kind === 'foto') URL.revokeObjectURL(attaching.url);
		attaching = null;
		attachProblem = null;
	}

	async function pickedPhoto(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		dropAttachment();
		try {
			const small = await shrinkPhoto(file);
			attaching = { kind: 'foto', ...small, url: URL.createObjectURL(small.blob) };
		} catch (err) {
			attachProblem = err instanceof Error ? err.message : String(err);
		}
	}

	async function lookWhere() {
		menu = false;
		dropAttachment();
		attaching = { kind: 'buscando' };
		try {
			attaching = { kind: 'ubicacion', place: await herePosition() };
		} catch (err) {
			attaching = null;
			attachProblem = err instanceof Error ? err.message : String(err);
		}
	}

	async function sendAttachment() {
		const a = attaching;
		if (!a || a.kind === 'buscando' || sending) return;
		sending = true;
		const ok =
			a.kind === 'foto'
				? await client.sendPhoto({ blob: a.blob, width: a.width, height: a.height })
				: await client.sendPlace(a.place);
		sending = false;
		if (ok) dropAttachment();
	}

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
	/**
	 * With someone of the family (the family's own conversation, or two people of it): sharing is
	 * referring then; with a linked family, copying (#555).
	 */
	const sameFamily = $derived(
		open?.kind === 'familia' ||
			(open?.kind === 'pareja' &&
				data.contacts.find((c) => c.userId === open.with)?.family === null)
	);

	/** A recipe of the book to send, from Recetas' «📤 Mandar» (#555): to the conversation chosen. */
	let sharing = $state(untrack(() => data.sharing));
	let sharingBusy = $state(false);
	function stopSharing() {
		sharing = null;
		replaceState('/mensajes', {});
	}
	async function sendShared() {
		if (!sharing || sharingBusy) return;
		sharingBusy = true;
		const ok = await client.sendCard(bookRecipeCard(sharing, sameFamily));
		sharingBusy = false;
		if (ok) stopSharing();
	}
	const title = $derived(
		!open ? '' : open.kind === 'familia' ? 'Familia' : open.with ? nameOf(open.with) : ''
	);
	const preview = (m: StoredMessage | null, group: boolean) =>
		!m
			? 'Sin mensajes todavía'
			: `${m.mine ? 'Tú: ' : group ? `${nameOf(m.userId)}: ` : ''}${describe(m)}`;
</script>

<!-- The «+» menu closed by a touch anywhere else, or Escape. -->
<svelte:window
	onpointerdown={(e) => menu && !menuBox?.contains(e.target as Node) && (menu = false)}
	onkeydown={(e) => menu && e.key === 'Escape' && (menu = false)}
/>

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
		{#if sharing}
			<div
				class="mb-3 flex items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
			>
				<p class="min-w-0 flex-1 text-sm">
					📤 Elige a quién mandar <strong>«{sharing.recipe.title}»</strong>
				</p>
				<button class="text-sm text-zinc-400 hover:text-white" onclick={stopSharing}
					>Cancelar</button
				>
			</div>
		{/if}
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
							'max-w-[85%] rounded-2xl break-words',
							m.card ? 'w-full' : m.photo ? 'p-1' : 'px-3 py-2',
							!m.audio && !m.photo && !m.place && !m.card && 'whitespace-pre-wrap',
							!m.card && (m.mine ? 'bg-amber-500 text-zinc-950' : 'bg-zinc-800 text-zinc-100')
						]}
					>
						{#if m.audio}<AudioBurbuja {m} {client} />{:else if m.photo}<FotoBurbuja
								{m}
								{client}
							/>{:else if m.place}<UbicacionBurbuja
								place={m.place}
								mine={m.mine}
							/>{:else if m.card}<TarjetaBurbuja
								{m}
								toBuy={data.toBuy}
								saved={data.saved}
							/>{:else}{m.text}{/if}
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
		{#if attaching}
			<div class="mb-3 rounded-md border border-zinc-700 bg-zinc-900 p-3">
				{#if attaching.kind === 'buscando'}
					<p class="text-sm text-zinc-300" role="status">📍 Buscando dónde estás…</p>
					<button class="mt-2 text-sm text-zinc-400 hover:text-white" onclick={dropAttachment}
						>Cancelar</button
					>
				{:else}
					{#if attaching.kind === 'foto'}
						<img
							src={attaching.url}
							alt="La foto que vas a enviar"
							class="mx-auto mb-3 max-h-72 rounded-md object-contain"
						/>
					{:else}
						<PlacesMap
							marks={[
								{ at: [attaching.place.lon, attaching.place.lat], label: 'Aquí', current: true }
							]}
							height="h-56"
						/>
						<p class="mt-2 mb-3 text-sm text-zinc-300">
							Tu ubicación de ahora{#if attaching.place.accuracy !== undefined}, con unos {attaching
									.place.accuracy} m de margen{/if}. Solo la verán quienes están en esta
							conversación.
						</p>
					{/if}
					<div class="flex gap-2">
						<button
							class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
							disabled={sending || client.waiting}
							onclick={sendAttachment}
							>{sending
								? 'Enviando…'
								: attaching.kind === 'foto'
									? 'Enviar la foto'
									: 'Enviar mi ubicación'}</button
						>
						<button
							class="rounded-md px-4 py-2 text-zinc-300 hover:text-white"
							disabled={sending}
							onclick={dropAttachment}>Cancelar</button
						>
					</div>
				{/if}
			</div>
		{/if}
		{#if attachProblem}
			<p class="mb-2 text-sm text-red-400">{attachProblem}</p>
		{/if}
		{#if sharing}
			<div class="mb-3 rounded-md border border-zinc-700 bg-zinc-900 p-3">
				<p class="font-semibold">🍰 {sharing.recipe.title}</p>
				<p class="mb-3 text-sm text-zinc-400">
					{sameFamily
						? 'Está en vuestro recetario: se manda el enlace, sin copiarla.'
						: 'Se manda entera, para que la guarden en su recetario.'}
				</p>
				<div class="flex gap-2">
					<button
						class="rounded-md bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
						disabled={sharingBusy || client.waiting}
						onclick={sendShared}>{sharingBusy ? 'Enviando…' : 'Enviar la receta'}</button
					>
					<button class="rounded-md px-4 py-2 text-zinc-300 hover:text-white" onclick={stopSharing}
						>Cancelar</button
					>
				</div>
			</div>
		{/if}
		{#if panel}
			<AsistentePanel
				name={aiName}
				to={open?.kind === 'familia' ? 'la familia' : title}
				request={panel}
				{sameFamily}
				onsend={(card) => client.sendCard(card)}
				onclose={() => (panel = null)}
			/>
		{/if}
		{#if finished !== null}
			<button
				type="button"
				class="mb-2 rounded-full border border-violet-500/50 bg-violet-950/40 px-3 py-1 text-sm text-violet-200"
				onclick={() => ((text = finished ?? text), box?.focus())}>✨ @{aiName.toLowerCase()}</button
			>
		{:else if forAi !== null}
			<p id="para-la-ia" class="mb-2 text-sm text-violet-300">
				✨ Esto se lo pides a {aiName}: no se manda a nadie. Te enseñará opciones para elegir.
			</p>
		{/if}
		<input bind:this={picker} type="file" accept="image/*" class="hidden" onchange={pickedPhoto} />
		<form class="relative flex gap-2" onsubmit={send}>
			<div bind:this={menuBox} class="contents">
				<button
					type="button"
					class="rounded-md border border-zinc-700 px-3 text-xl leading-none text-zinc-200 hover:bg-zinc-800 disabled:opacity-50"
					aria-label="Enviar una foto, tu ubicación o pedir algo a {aiName}"
					aria-expanded={menu}
					disabled={client.waiting}
					onclick={() => (menu = !menu)}>+</button
				>
				{#if menu}
					<div
						class="absolute bottom-full left-0 z-10 mb-2 flex flex-col overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-lg"
					>
						<button
							type="button"
							class="px-4 py-3 text-left hover:bg-zinc-800"
							onclick={() => ((menu = false), picker?.click())}>📷 Foto</button
						>
						<button type="button" class="px-4 py-3 text-left hover:bg-zinc-800" onclick={lookWhere}
							>📍 Ubicación</button
						>
						{#if data.hasAi}
							<button
								type="button"
								class="px-4 py-3 text-left hover:bg-zinc-800"
								onclick={() => ((menu = false), (panel = { first: null }))}>✨ {aiName}</button
							>
						{/if}
					</div>
				{/if}
			</div>
			<input
				bind:this={box}
				bind:value={text}
				maxlength={MAX_TEXT}
				placeholder={open?.kind === 'familia' ? 'Escribe a la familia' : `Escribe a ${title}`}
				aria-label="Mensaje"
				aria-describedby={forAi !== null ? 'para-la-ia' : undefined}
				class={[
					'min-w-0 flex-1 rounded-md bg-zinc-900',
					// For the AI (#555): its panel's colour, not the amber of sending.
					forAi !== null
						? 'border-violet-500 ring-2 ring-violet-500/60 focus:border-violet-400 focus:ring-violet-400'
						: 'border-zinc-700'
				]}
			/>
			{#if text.trim()}
				<button
					class={[
						'rounded-md px-4 py-2 font-medium disabled:opacity-50',
						forAi !== null
							? 'bg-violet-500 text-white hover:bg-violet-400'
							: 'bg-amber-500 text-zinc-950 hover:bg-amber-400'
					]}
					disabled={sending || client.waiting}
					>{forAi !== null ? `✨ Pedir a ${aiName}` : 'Enviar'}</button
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
