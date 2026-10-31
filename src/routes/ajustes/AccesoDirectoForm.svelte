<script module lang="ts">
	import type { Candidate, ShortcutKind } from '#lib/tv-shortcut-kinds.ts';

	/** Each kind's, asked once for every form on the page. */
	const asked = new Map<ShortcutKind, Promise<Candidate[] | null>>();

	function candidatesOf(kind: ShortcutKind) {
		let found = asked.get(kind);
		if (!found) {
			found = fetch(`/api/accesos/destinos?tipo=${kind}`)
				.then((res) => (res.ok ? (res.json() as Promise<Candidate[]>) : null))
				.catch(() => null);
			// A failure is asked again next time.
			found.then((list) => {
				if (!list) asked.delete(kind);
			});
			asked.set(kind, found);
		}
		return found;
	}
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { SHORTCUT_KINDS } from '#lib/tv-shortcut-kinds.ts';
	import { select, secondary } from './styles.ts';

	/**
	 * A TV shortcut, new (`s` null) or changed (#327, #343): a site's address, or what of the TV
	 * view's own it opens, chosen from a list with a search box.
	 */
	let {
		s,
		tab
	}: {
		s: {
			id: number;
			name: string;
			kind: ShortcutKind;
			url: string | null;
			target: string | null;
			tags: string[];
		} | null;
		tab: string;
	} = $props();

	// The form's own from here on: what it was, only to start with.
	// svelte-ignore state_referenced_locally
	let kind = $state<ShortcutKind>(s?.kind ?? 'url');
	// svelte-ignore state_referenced_locally
	let target = $state(s?.target ?? '');
	let search = $state('');
	let list = $state<Candidate[] | null | undefined>();

	$effect(() => {
		if (kind === 'url') return;
		const wanted = kind;
		list = undefined;
		candidatesOf(wanted).then((found) => {
			if (kind === wanted) list = found;
		});
	});

	/** Those matching the search, by name or detail; the chosen one always. */
	const shown = $derived.by(() => {
		const words = search.trim().toLocaleLowerCase('es');
		return (list ?? []).filter(
			(c) =>
				!words ||
				c.target === target ||
				`${c.name} ${c.detail ?? ''}`.toLocaleLowerCase('es').includes(words)
		);
	});
</script>

<form
	method="post"
	action="?seccion={tab}&/saveShortcut"
	use:enhance={() =>
		async ({ update, result }) => {
			await update({ reset: !s });
			if (!s && result.type === 'success') {
				kind = 'url';
				target = '';
				search = '';
			}
		}}
	class="flex flex-col gap-2"
>
	{#if s}<input type="hidden" name="id" value={s.id} />{/if}
	<select name="kind" bind:value={kind} aria-label="Qué abre" class="{select} min-w-0">
		{#each Object.entries(SHORTCUT_KINDS) as [value, label] (value)}
			<option {value}>{label}</option>
		{/each}
	</select>
	{#if kind === 'url'}
		<input
			name="url"
			type="url"
			required
			value={s?.url ?? ''}
			placeholder="https://www.crunchyroll.com/es/"
			aria-label="Dirección"
			class="{select} min-w-0"
		/>
	{:else if list === undefined}
		<p class="text-sm text-zinc-400">Cargando…</p>
	{:else if list === null}
		<p class="text-sm text-red-400">No se pudo cargar la lista. Prueba otra vez.</p>
	{:else if !list.length}
		<p class="text-sm text-zinc-400">No hay ninguno de este tipo en casa.</p>
	{:else}
		{#if list.length > 8}
			<input
				type="search"
				bind:value={search}
				placeholder="Buscar…"
				aria-label="Buscar"
				class="{select} min-w-0"
			/>
		{/if}
		<select
			name="target"
			required
			bind:value={target}
			aria-label={SHORTCUT_KINDS[kind]}
			class="{select} min-w-0"
		>
			<option value="" disabled>Elige {SHORTCUT_KINDS[kind].toLocaleLowerCase('es')}</option>
			{#each shown as c (c.target)}
				<option value={c.target}>{c.detail ? `${c.name} · ${c.detail}` : c.name}</option>
			{/each}
		</select>
	{/if}
	<input
		name="name"
		required={kind === 'url'}
		maxlength="40"
		value={s?.name ?? ''}
		placeholder={kind === 'url' ? 'Crunchyroll' : 'Nombre (si no, el suyo)'}
		aria-label="Nombre"
		class="{select} min-w-0"
	/>
	<input
		name="tags"
		value={s?.tags.join(', ') ?? ''}
		placeholder={kind === 'url' ? 'infantil, dibujos' : 'deportes, mañanas'}
		aria-label="Etiquetas, separadas por comas"
		class="{select} min-w-0"
	/>
	<div class="flex items-center gap-3">
		<button class={secondary}>{s ? 'Guardar' : 'Añadir'}</button>
		{#if s}
			{#if s.kind === 'url'}
				<button
					formaction="?seccion={tab}&/shortcutIcon"
					formnovalidate
					class="text-sm text-zinc-300 hover:underline">Volver a buscar el icono</button
				>
			{/if}
			<button
				formaction="?seccion={tab}&/deleteShortcut"
				formnovalidate
				class="text-sm text-red-400 hover:underline">Borrar</button
			>
		{/if}
	</div>
</form>
