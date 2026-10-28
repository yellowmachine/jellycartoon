<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import UpdateProgress from '#lib/components/UpdateProgress.svelte';
	import { section, primary } from './styles.ts';
	import type { PageData, ActionData } from './$types';

	/** Versión: la nueva, sus notas y «Actualizar ahora». */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	/** «Actualizar ahora» sent and not answered yet. */
	let askingUpdate = $state(false);

	/** WUD is updating (#20): UpdateProgress follows it, over the page. */
	const updating = $derived(Boolean(form && 'updating' in form && form.updating));

	/** After an update, the page loaded the new version: from which one, said once. */
	let justUpdated = $state<{ from: string; to: string } | null>(null);
	onMount(() => {
		try {
			const done = JSON.parse(sessionStorage.getItem('jellycartoon:updated') ?? 'null');
			sessionStorage.removeItem('jellycartoon:updated');
			if (done?.to === data.version.current) justUpdated = done;
		} catch {
			// Private window: no message, the version says it all the same.
		}
	});
</script>

<section class={section} id="version">
	<h2 class="mb-1 font-semibold">Versión</h2>
	{#if justUpdated}
		<p
			class="mb-3 rounded-md border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-300"
			role="status"
		>
			✓ Actualizado de la {justUpdated.from} a la {justUpdated.to}.
		</p>
	{/if}
	<p class="text-sm text-zinc-400">
		{#if data.version.release}
			Tienes la {data.version.current}.
		{:else}
			Versión de pruebas ({data.version.current.slice(0, 11)}): se actualiza con cada cambio, sin
			versiones numeradas.
		{/if}
	</p>
	{#if data.version.update}
		{@const update = data.version.update}
		<div class="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
			<p class="font-medium text-amber-300">Hay una versión nueva: la {update.version}</p>
			{#if update.notesHtml}
				<!-- The release's Markdown as GitHub makes it HTML (updates.ts); its links, apart. -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div
					class="release-notes mt-2 max-h-80 overflow-y-auto text-sm text-zinc-300"
					onclick={(e) => {
						const link = (e.target as HTMLElement).closest('a');
						if (!link?.href) return;
						e.preventDefault();
						window.open(link.href, '_blank', 'noreferrer');
					}}
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -- the release notes as GitHub's API gives them, already sanitized (body_html). -->
					{@html update.notesHtml}
				</div>
			{/if}
			<a
				href={update.url}
				target="_blank"
				rel="noreferrer"
				class="mt-2 inline-block text-sm text-amber-400 hover:underline">Ver en GitHub</a
			>
			{#if updating}
				<p class="mt-3 text-sm">Actualizando…</p>
				<UpdateProgress current={data.version.current} target={update.version} />
			{:else if data.version.canUpdate}
				<!-- Once: pressed again while it is asked, WUD got it twice and one failed. -->
				<form
					method="post"
					action="?seccion={tab}&/update"
					use:enhance={() => {
						askingUpdate = true;
						return async ({ update }) => {
							await update();
							askingUpdate = false;
						};
					}}
					class="mt-3 flex flex-wrap items-center gap-3"
				>
					<button class={primary} disabled={askingUpdate}
						>{askingUpdate ? 'Pidiendo la actualización…' : 'Actualizar ahora'}</button
					>
					<span class="text-xs text-zinc-400"
						>Antes se hace una copia de la base de datos. Si no, se instalará sola esta madrugada.</span
					>
				</form>
			{:else}
				<p class="mt-3 text-sm text-zinc-400">
					Para instalarla, en el equipo: <code>docker compose -f compose.prod.yaml pull</code> y
					<code>up -d</code>.
				</p>
			{/if}
			{#if form && 'section' in form && form.section === 'version'}
				<p class="mt-3 text-sm break-words text-red-400">{form.message}</p>
			{/if}
		</div>
	{/if}
</section>

<style>
	/* A release's notes, as GitHub writes them in HTML: headings, lists, bold and links. */
	.release-notes :global(:is(h1, h2, h3, h4)) {
		margin: 0.9em 0 0.3em;
		font-weight: 600;
		color: var(--color-zinc-100);
	}
	.release-notes :global(h2) {
		font-size: 1.05em;
	}
	.release-notes :global(:is(h1, h2, h3, h4):first-child) {
		margin-top: 0;
	}
	.release-notes :global(:is(p, ul, ol)) {
		margin: 0.4em 0;
	}
	.release-notes :global(ul) {
		list-style: disc;
		padding-left: 1.25em;
	}
	.release-notes :global(ol) {
		list-style: decimal;
		padding-left: 1.25em;
	}
	.release-notes :global(li + li) {
		margin-top: 0.25em;
	}
	.release-notes :global(strong) {
		color: var(--color-zinc-100);
	}
	.release-notes :global(a) {
		color: var(--color-amber-400);
	}
	.release-notes :global(a:hover) {
		text-decoration: underline;
	}
	.release-notes :global(code) {
		border-radius: 0.25em;
		background: var(--color-zinc-800);
		padding: 0 0.3em;
	}
</style>
