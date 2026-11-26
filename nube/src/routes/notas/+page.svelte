<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import NoteButton from '#lib/components/NoteButton.svelte';
	import WalkUploads from '#lib/components/WalkUploads.svelte';
	import { noteRecorder } from '#lib/note-recorder.svelte.ts';
	import { herePosition, shrinkPhoto } from '#lib/mensajes/photo.ts';
	import { MAX_NOTE_TEXT, MAX_NOTE_TAGS, notesAndPhotos, photoMoment } from '#lib/notes.ts';
	import { photoTaken } from '#lib/photo-taken.ts';
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

	/** The photo of the note being written, already small, and to see it. */
	let photo = $state<Blob | null>(null);
	let photoUrl = $state<string | null>(null);
	let saving = $state(false);
	/** When and where that photo was taken (#613): just now and here, or as its file says. */
	let takenAt = $state<Date | null>(null);
	let takenHere = $state<[number, number] | null>(null);
	let placed = $state(true);
	/** The photo open, big. */
	let open = $state<{ src: string; alt: string } | null>(null);
	let deletingPhoto = $state<number | null>(null);

	/** Where this device is, if it knows and may say it: never in the way of a note. */
	const here = () =>
		herePosition()
			.then((p): [number, number] => [p.lon, p.lat])
			.catch(() => null);

	/** This page with what is chosen now, but for what changes (#634). */
	const link = (change: { tab?: 'todas' | 'casa' | 'leer'; etiqueta?: string | null }) => {
		const tab = change.tab ?? (data.reading ? 'leer' : data.house ? 'casa' : 'todas');
		const params = new URLSearchParams();
		if (tab !== 'todas') params.set(tab, '');
		const tag = change.etiqueta === undefined ? data.tag : change.etiqueta;
		if (tag) params.set('etiqueta', tag);
		const query = `${params}`.replace(/=(&|$)/g, '$1');
		return query ? `/notas?${query}` : '/notas';
	};
	const chip = (on: boolean) =>
		on ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400 hover:text-white';
	let pasting = $state(false);

	const items = $derived(
		notesAndPhotos(data.notes, data.photos, (d) => d.toLocaleDateString('sv'))
	);

	$effect(() => {
		if (!photo) return;
		const url = URL.createObjectURL(photo);
		photoUrl = url;
		return () => {
			URL.revokeObjectURL(url);
			photoUrl = null;
		};
	});

	async function picked(input: HTMLInputElement, camera: boolean) {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		problem = null;
		try {
			const now = new Date();
			// Read before it is made small: that leaves it out.
			const taken = photoTaken(await file.arrayBuffer());
			photo = (await shrinkPhoto(file)).blob;
			writing = true;
			placed = true;
			takenAt = camera ? now : taken.at && photoMoment(taken.at.getTime());
			takenHere = camera ? null : taken.position;
			if (camera) {
				const mine = photo;
				void here().then((p) => {
					// Not another photo's, taken meanwhile.
					if (photo === mine) takenHere = p;
				});
			}
		} catch (err) {
			problem = (err as Error).message;
		}
	}

	function stopWriting() {
		writing = false;
		photo = null;
		takenAt = takenHere = null;
	}

	// What a walk going on or not sent yet took, it sends itself afterwards.
	const send = () => walkUploads.send(data.user!.id);

	onMount(() => void walkUploads.look(data.user!.id));

	/** Where the note being recorded is: asked as it starts, so keeping it waits for nothing. */
	let recordedHere: [number, number] | null = null;
	$effect(() => {
		if (!noteRecorder.recording) return;
		recordedHere = null;
		let current = true;
		void here().then((p) => {
			if (current) recordedHere = p;
		});
		return () => (current = false);
	});

	async function recorded(audio: Blob) {
		problem = null;
		const position = recordedHere;
		try {
			await keepAttachment({
				userId: data.user!.id,
				kind: 'nota',
				blob: audio,
				at: Date.now(),
				position,
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

{#snippet pick(text: string, camera: boolean)}
	<label
		class={[
			'cursor-pointer rounded-md bg-zinc-800 px-4 py-2 focus-within:ring-2 focus-within:ring-amber-300 hover:bg-zinc-700',
			saving && 'pointer-events-none opacity-50'
		]}
	>
		{text}
		<input
			type="file"
			accept="image/*"
			capture={camera ? 'environment' : undefined}
			class="sr-only"
			disabled={saving}
			onchange={(e) => picked(e.currentTarget, camera)}
		/>
	</label>
{/snippet}

<h1 class="mb-1 text-2xl font-bold">Notas</h1>
<p class="mb-6 text-sm text-zinc-400">
	Lo que escribes o dictas, para buscarlo luego: aquí, en un paseo o diciéndole a la voz «toma
	nota». Con una foto, si quieres, y también las de los paseos. Solo para ti, si no la compartes con
	la casa; las dichas a un altavoz, para todos.
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
	{@render pick('📷 Foto', true)}
	{@render pick('🖼️ Elegir una foto', false)}
</div>
{#if writing}
	<form
		method="post"
		action="?/write"
		enctype="multipart/form-data"
		class="mb-4"
		use:enhance={({ formData }) => {
			if (photo) {
				formData.set('photo', photo, 'foto.jpg');
				if (takenAt) formData.set('at', String(takenAt.getTime()));
				if (takenHere && placed) {
					formData.set('lon', String(takenHere[0]));
					formData.set('lat', String(takenHere[1]));
				}
			}
			saving = true;
			problem = null;
			return async ({ result, update }) => {
				saving = false;
				// Without coverage: what is written stays here, to try again.
				if (result.type === 'error') {
					problem = 'No se ha podido guardar. Prueba otra vez.';
					return;
				}
				await update();
				if (result.type === 'success') stopWriting();
			};
		}}
	>
		{#if photoUrl}
			<div class="mb-2 flex items-end gap-3">
				<img src={photoUrl} alt="Foto de la nota" class="max-h-48 rounded-md" />
				<button
					type="button"
					class="text-sm text-zinc-400 hover:text-white"
					onclick={() => (photo = null)}>Quitar la foto</button
				>
			</div>
		{/if}
		<!-- svelte-ignore a11y_autofocus -->
		<textarea
			name="text"
			rows="3"
			required={!photo}
			autofocus
			maxlength={MAX_NOTE_TEXT}
			aria-label="Nota"
			placeholder={photo ? 'Qué es (para encontrarla luego)' : 'Escribe la nota'}
			class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 text-sm focus:border-amber-500 focus:ring-amber-500"
		></textarea>
		{#if photo && takenAt}
			<p class="mb-2 text-xs text-zinc-400">
				Se guarda con la hora de la foto: {when.format(takenAt)}.
			</p>
		{/if}
		{#if photo && takenHere}
			<label class="mb-2 flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					bind:checked={placed}
					class="rounded border-zinc-600 bg-zinc-950 text-amber-500"
				/>
				📍 Guardar dónde se hizo (solo lo ves tú)
			</label>
		{/if}
		<input
			name="tags"
			list="etiquetas"
			placeholder="Etiquetas: cocina, niños…"
			aria-label="Etiquetas, separadas por comas (hasta {MAX_NOTE_TAGS})"
			class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
		/>
		<div class="flex flex-wrap items-center gap-3 text-sm">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					name="shared"
					checked={data.house}
					class="rounded border-zinc-600 bg-zinc-950 text-amber-500"
				/>
				Para toda la casa
			</label>
			<button
				class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950 disabled:opacity-50"
				disabled={saving}>{saving ? 'Guardando…' : 'Guardar'}</button
			>
			<button type="button" class="text-zinc-400" onclick={stopWriting}>Cancelar</button>
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

<datalist id="etiquetas">
	{#each data.tags as t (t)}<option value={t}></option>{/each}
</datalist>

<nav class="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Qué notas">
	{#each [{ tab: 'todas', on: !data.house && !data.reading, label: 'Todas' }, { tab: 'casa', on: data.house, label: 'De la casa' }, { tab: 'leer', on: data.reading, label: '📖 Para leer' }] as const as t (t.tab)}
		<a
			href={link({ tab: t.tab })}
			aria-current={t.on ? 'page' : undefined}
			class={[
				'rounded-full px-3 py-1',
				t.on ? 'bg-zinc-700 text-white' : 'bg-zinc-900 text-zinc-400'
			]}>{t.label}</a
		>
	{/each}
</nav>
{#if data.tags.length}
	<nav class="mb-3 flex flex-wrap gap-2 text-xs" aria-label="Etiquetas">
		<a href={link({ etiqueta: null })} class="rounded-full px-2.5 py-1 {chip(!data.tag)}"
			>Todas las etiquetas</a
		>
		{#each data.tags as t (t)}
			<a
				href={link({ etiqueta: t })}
				aria-current={data.tag === t ? 'page' : undefined}
				class="rounded-full px-2.5 py-1 {chip(data.tag === t)}">#{t}</a
			>
		{/each}
	</nav>
{/if}
{#if data.reading}
	<form
		method="post"
		action="?/link"
		class="mb-4 flex flex-wrap gap-2"
		use:enhance={() => {
			pasting = true;
			return async ({ update }) => {
				await update();
				pasting = false;
			};
		}}
	>
		<input
			name="url"
			type="url"
			required
			placeholder="Pega el enlace de una web para leerla luego"
			aria-label="Enlace de la web"
			class="min-w-0 flex-1 basis-64 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
		/>
		<input
			name="tags"
			list="etiquetas"
			placeholder="Etiquetas"
			aria-label="Etiquetas, separadas por comas"
			class="w-36 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
		/>
		<button
			class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-zinc-950 disabled:opacity-50"
			disabled={pasting}>{pasting ? 'Leyendo la web…' : 'Guardar'}</button
		>
	</form>
	{#if form && 'saved' in form && form.saved}
		<p class="mb-4 text-sm text-emerald-300" role="status">{form.saved}</p>
	{/if}
	<p class="mb-4 text-xs text-zinc-500">
		Se guarda limpia, como en el modo lectura del navegador: el texto, sin anuncios ni fotos.
		También desde el marcador «📥 A Seilide» o compartiendo el enlace con Seilide en el móvil.
	</p>
{/if}
<form method="get" class="mb-6 flex gap-2">
	{#if data.house}<input type="hidden" name="casa" value="" />{/if}
	{#if data.reading}<input type="hidden" name="leer" value="" />{/if}
	{#if data.tag}<input type="hidden" name="etiqueta" value={data.tag} />{/if}
	<input
		name="q"
		type="search"
		value={data.q ?? ''}
		placeholder={data.reading
			? 'Buscar en lo guardado para leer'
			: data.house
				? 'Buscar en las de la casa'
				: 'Buscar en las notas'}
		class="min-w-0 flex-1 rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
	/>
	<button class="rounded-md bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">Buscar</button>
</form>

{#if items.length}
	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each items as item (item.key)}
			{#if 'photos' in item}
				<li class="p-3">
					<p class="mb-1 text-xs text-zinc-500">
						{when.format(item.at)} · {item.photos.length === 1 ? 'Foto' : 'Fotos'} de un paseo
						{#if item.walkId !== null}·
							<a href="/paseos?paseo={item.walkId}" class="text-amber-400 hover:underline"
								>Ver el paseo</a
							>{:else}borrado{/if}
					</p>
					<ul class="flex flex-wrap gap-2">
						{#each item.photos as p (p.id)}
							<li class="flex flex-col items-center gap-1">
								<button
									type="button"
									aria-label="Ver la foto en grande"
									onclick={() => (open = { src: `/paseos/fotos/${p.id}`, alt: 'Foto del paseo' })}
								>
									<img
										src="/paseos/fotos/{p.id}"
										alt="Foto del paseo"
										loading="lazy"
										class="h-28 w-28 rounded-md object-cover"
									/>
								</button>
								{#if deletingPhoto === p.id}
									<form method="post" action="?/deletePhoto" use:enhance class="flex gap-2 text-xs">
										<input type="hidden" name="id" value={p.id} />
										<button class="text-red-400">Sí, borrarla</button>
										<button
											type="button"
											class="text-zinc-400"
											onclick={() => (deletingPhoto = null)}>No</button
										>
									</form>
								{:else}
									<button
										class="text-xs text-zinc-500 hover:text-red-400"
										onclick={() => (deletingPhoto = p.id)}>Borrar</button
									>
								{/if}
							</li>
						{/each}
					</ul>
				</li>
			{:else}
				{@const n = item.note}
				<li class="p-3">
					<p class="mb-1 text-xs text-zinc-500">
						{when.format(new Date(n.at))} · {n.link
							? 'Para leer'
							: n.photo && n.source === 'escrita'
								? 'Con foto'
								: SOURCE[n.source]}{n.author ? ` · de ${n.author}` : ''}{n.shared
							? ' · para toda la casa'
							: ''}{n.lon !== null ? ' · 📍' : ''}
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
							<input
								name="tags"
								list="etiquetas"
								value={n.tags.join(', ')}
								placeholder="Etiquetas: cocina, niños…"
								aria-label="Etiquetas, separadas por comas"
								class="mb-2 w-full rounded-md border-zinc-700 bg-zinc-950 py-1.5 text-sm focus:border-amber-500 focus:ring-amber-500"
							/>
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
						{#if n.text || !n.photo}
							<p class="break-words whitespace-pre-wrap">{n.text || '(sin palabras)'}</p>
						{/if}
					{:else if n.hearing === 'pending'}
						<p class="text-sm text-zinc-400">Transcribiendo…</p>
					{:else}
						<p class="text-sm text-amber-300">No se pudo transcribir.</p>
					{/if}
					{#if n.link && editing !== n.id}
						<p class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
							{#if n.article}
								<a href="/notas/{n.id}/leer" class="font-medium text-amber-400 hover:underline"
									>📖 Leer</a
								>
								<span class="text-zinc-500"
									>{n.article.minutes} min{n.article.site ? ` · ${n.article.site}` : ''}</span
								>
							{:else}
								<span class="text-zinc-500">Sin el texto: esa web no deja leerla desde Seilide</span
								>
							{/if}
							<a
								href={n.link}
								target="_blank"
								rel="noopener noreferrer"
								class="truncate text-zinc-400 hover:underline"
								>{new URL(n.link).hostname.replace(/^www\./, '')} ↗</a
							>
						</p>
					{/if}
					{#if n.tags.length && editing !== n.id}
						<p class="mt-1 flex flex-wrap gap-1.5 text-xs">
							{#each n.tags as t (t)}
								<a
									href={link({ etiqueta: t })}
									class="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300 hover:text-white"
									>#{t}</a
								>
							{/each}
						</p>
					{/if}
					{#if n.photo}
						<button
							type="button"
							class="mt-2 block"
							aria-label="Ver la foto en grande"
							onclick={() => (open = { src: n.photo!, alt: n.text || 'Foto' })}
						>
							<img
								src={n.photo}
								alt={n.text || 'Foto'}
								loading="lazy"
								class="max-h-48 max-w-full rounded-md"
							/>
						</button>
					{/if}
					{#if n.hasAudio}
						<audio controls preload="none" src="/notas/{n.id}/audio" class="mt-2 w-full"></audio>
					{/if}
					{#if editing !== n.id && n.canEdit}
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
							{#if n.mine}
								<form method="post" action="?/share" use:enhance>
									<input type="hidden" name="id" value={n.id} />
									<input type="hidden" name="shared" value={n.shared ? '0' : '1'} />
									<button class="text-zinc-400 hover:text-white"
										>{n.shared ? 'Solo para mí' : 'Compartir con la casa'}</button
									>
								</form>
							{/if}
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
			{/if}
		{/each}
	</ul>
{:else if data.q}
	<p class="text-zinc-400">Ninguna nota dice «{data.q}».</p>
{:else}
	<p class="text-zinc-400">
		{data.tag
			? `Ninguna nota con #${data.tag}.`
			: data.reading
				? 'Nada guardado para leer todavía.'
				: data.house
					? 'Todavía no hay notas de toda la casa.'
					: 'Todavía no hay notas.'}
	</p>
{/if}

{#if open}
	<dialog
		{@attach (el) => el.showModal()}
		onclose={() => (open = null)}
		onclick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
		aria-label="Foto"
		class="tema-oscuro m-auto max-h-none max-w-none bg-transparent p-0 backdrop:bg-black/95"
	>
		<img src={open.src} alt={open.alt} class="max-h-[95dvh] max-w-[95vw] object-contain" />
		<form method="dialog">
			<button class="fixed top-3 right-3 rounded-full bg-zinc-800 px-4 py-2 text-white"
				>✕ Cerrar</button
			>
		</form>
	</dialog>
{/if}
