<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import NoteButton from '#lib/components/NoteButton.svelte';
	import WalkUploads from '#lib/components/WalkUploads.svelte';
	import { noteRecorder } from '#lib/note-recorder.svelte.ts';
	import { MAX_NOTE_TEXT } from '#lib/notes.ts';
	import { keepAttachment } from '#lib/walk-attachments.ts';
	import { walkUploads } from '#lib/walk-uploads.svelte.ts';
	import type { PageProps } from './$types';

	/**
	 * Notas (#416): what is dictated, recorded here or on a walk, or said to the voice. Heard by
	 * itself; the text can be corrected, and the recording is still there to listen to.
	 */
	let { data, form }: PageProps = $props();

	const when = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' });
	const SOURCE = { pagina: 'Grabada', paseo: 'En un paseo', voz: 'Por voz', escrita: 'Escrita' };

	/** The form for a note written by hand. */
	let writing = $state(false);
	let editing = $state<number | null>(null);
	let deleting = $state<number | null>(null);
	let problem = $state<string | null>(null);

	// What a walk going on or not sent yet took, it sends itself afterwards.
	const send = () => walkUploads.send(data.user!.id);

	onMount(() => void walkUploads.look(data.user!.id));

	async function recorded(audio: Blob) {
		problem = null;
		try {
			await keepAttachment({
				userId: data.user!.id,
				kind: 'nota',
				blob: audio,
				at: Date.now(),
				position: null,
				walk: null
			});
		} catch {
			problem = 'No se ha podido guardar en este móvil.';
			return;
		}
		await send();
	}
</script>

<svelte:head>
	<title>Notas · Seilide</title>
</svelte:head>

<h1 class="mb-1 text-2xl font-bold">Notas</h1>
<p class="mb-6 text-sm text-zinc-400">
	Lo que escribes o dictas, para buscarlo luego: aquí, en un paseo o diciéndole a la voz «toma
	nota». Solo para ti; las dichas a un altavoz, para toda la casa.
</p>

<div class="mb-4 flex flex-wrap items-center gap-3">
	<NoteButton
		onrecorded={recorded}
		class="rounded-md bg-amber-500 px-4 py-2 font-semibold text-zinc-950"
	/>
	<button
		class="rounded-md bg-zinc-800 px-4 py-2 hover:bg-zinc-700"
		onclick={() => (writing = true)}>✍️ Escribir</button
	>
</div>
{#if writing}
	<form
		method="post"
		action="?/write"
		class="mb-4"
		use:enhance={() =>
			async ({ result, update }) => {
				await update();
				if (result.type === 'success') writing = false;
			}}
	>
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			name="text"
			rows="3"
			required
			autofocus
			maxlength={MAX_NOTE_TEXT}
			aria-label="Nota"
			placeholder="Escribe la nota"
			class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 text-sm focus:border-amber-500 focus:ring-amber-500"
		></textarea>
		<div class="flex gap-3 text-sm">
			<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950">Guardar</button>
			<button type="button" class="text-zinc-400" onclick={() => (writing = false)}>Cancelar</button
			>
		</div>
	</form>
{/if}
<WalkUploads />
{#if noteRecorder.problem || problem}
	<p class="mb-4 text-sm text-amber-300" role="alert">{noteRecorder.problem ?? problem}</p>
{/if}
{#if form?.message}
	<p class="mb-4 text-sm text-red-400" role="alert">{form.message}</p>
{/if}

<form method="get" class="mb-6 flex gap-2">
	<input
		name="q"
		type="search"
		value={data.q ?? ''}
		placeholder="Buscar en las notas"
		class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
	/>
	<button class="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">Buscar</button>
</form>

{#if data.notes.length}
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each data.notes as n (n.id)}
			<li class="p-3">
				<p class="mb-1 text-xs text-zinc-500">
					{when.format(new Date(n.at))} · {SOURCE[n.source]}{n.mine ? '' : ' · de toda la casa'}
				</p>
				{#if editing === n.id}
					<form
						method="post"
						action="?/edit"
						use:enhance={() =>
							async ({ update }) => {
								await update();
								editing = null;
							}}
					>
						<input type="hidden" name="id" value={n.id} />
						<textarea
							name="text"
							rows="3"
							required
							class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 text-sm focus:border-amber-500 focus:ring-amber-500"
							>{n.text}</textarea
						>
						<div class="flex gap-3 text-sm">
							<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950"
								>Guardar</button
							>
							<button type="button" class="text-zinc-400" onclick={() => (editing = null)}
								>Cancelar</button
							>
						</div>
					</form>
				{:else if n.hearing === 'ready'}
					<p class="break-words whitespace-pre-wrap">{n.text || '(sin palabras)'}</p>
				{:else if n.hearing === 'pending'}
					<p class="text-sm text-zinc-400">Transcribiendo…</p>
				{:else}
					<p class="text-sm text-amber-300">No se pudo transcribir.</p>
				{/if}
				{#if n.hasAudio}
					<audio controls preload="none" src="/notas/{n.id}/audio" class="mt-2 w-full"></audio>
				{/if}
				{#if editing !== n.id}
					<div class="mt-2 flex flex-wrap items-center gap-3 text-sm">
						{#if n.hearing !== 'ready' && n.hasAudio && n.mine}
							<form method="post" action="?/hear" use:enhance>
								<input type="hidden" name="id" value={n.id} />
								<button class="text-amber-400 hover:underline">Transcribir otra vez</button>
							</form>
						{/if}
						<button class="text-zinc-400 hover:text-white" onclick={() => (editing = n.id)}
							>Corregir</button
						>
						{#if deleting === n.id}
							<form method="post" action="?/delete" use:enhance class="flex gap-3">
								<input type="hidden" name="id" value={n.id} />
								<button class="text-red-400">Sí, borrarla</button>
								<button type="button" class="text-zinc-400" onclick={() => (deleting = null)}
									>No</button
								>
							</form>
						{:else}
							<button class="text-zinc-500 hover:text-red-400" onclick={() => (deleting = n.id)}
								>Borrar</button
							>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
{:else if data.q}
	<p class="text-zinc-400">Ninguna nota dice «{data.q}».</p>
{:else}
	<p class="text-zinc-400">Todavía no hay notas.</p>
{/if}
