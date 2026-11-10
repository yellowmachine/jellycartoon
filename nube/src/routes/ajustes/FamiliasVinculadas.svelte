<script lang="ts">
	import { enhance } from '$app/forms';
	import ConfirmForm from 'comun/components/ConfirmForm.svelte';
	import { primary, secondary, section } from '#lib/styles.ts';
	import type { ActionData, PageData } from './$types';

	/**
	 * «Familias vinculadas» (#464): another family linked with this one, in pairs, for now so that the
	 * adults of both call each other. A link to send (or its QR, to show on this screen), which an
	 * adult of the other family accepts; those still waiting, and those linked, to remove. Any adult.
	 */
	let { data, form, tab }: { data: PageData; form: ActionData; tab: string } = $props();

	const links = $derived(data.familyLinks);
	const problem = $derived(form && 'linkProblem' in form ? form.linkProblem : null);
	const day = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
	let copied = $state<string | null>(null);
	let shownQr = $state<string | null>(null);
	let busy = $state(false);

	async function share(link: string) {
		const text = 'Para vincular nuestras familias en Seilide y poder llamarnos:';
		if (navigator.share) {
			try {
				await navigator.share({ title: 'Vincular familias', text, url: link });
				return;
			} catch (error) {
				// Closed without sharing: nothing to do. Not supported here: copied instead.
				if (error instanceof DOMException && error.name === 'AbortError') return;
			}
		}
		await navigator.clipboard.writeText(link);
		copied = link;
		setTimeout(() => (copied = copied === link ? null : copied), 2000);
	}
</script>

{#if links}
	<section class={section} id="familias-vinculadas">
		<h2 class="mb-1 font-semibold">Familias vinculadas</h2>
		<p class="mb-4 text-sm text-zinc-400">
			Vincula tu familia con otra (la de tus padres, la de tu hermana…) para que los mayores de las
			dos os veáis en Llamadas y podáis llamaros. Nada más se comparte, y los peques no salen. Se
			hace de dos en dos: que una familia esté vinculada con la tuya no la vincula con las demás.
		</p>

		{#if links.linked.length}
			<ul class="mb-4 divide-y divide-zinc-800">
				{#each links.linked as f (f.linkId)}
					<li class="flex flex-wrap items-center gap-2 py-2">
						<span class="min-w-0 flex-1">
							<span class="block truncate font-medium">{f.familyName}</span>
							<span class="block text-xs text-zinc-500">
								{f.people.map((p) => p.name).join(', ') || 'Sin mayores con cuenta'} · desde el {day(
									f.since
								)}
							</span>
						</span>
						<ConfirmForm
							action="?seccion={tab}&/unlinkFamily"
							fields={{ id: f.linkId }}
							label="Quitar vínculo"
							question="¿Quitar el vínculo con {f.familyName}? Dejaréis de veros en Llamadas; el historial de llamadas de cada familia se queda."
							yes="Sí, quitar"
							class={secondary}
						/>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			method="post"
			action="?seccion={tab}&/linkFamily"
			class="mb-4"
			use:enhance={() => {
				busy = true;
				return async ({ update, result }) => {
					await update();
					busy = false;
					if (result.type === 'success' && typeof result.data?.linkMade === 'string')
						shownQr = result.data.linkMade;
				};
			}}
		>
			<button disabled={busy} class={primary}>
				{busy ? 'Creando…' : 'Crear un enlace para vincular otra familia'}
			</button>
		</form>
		{#if problem}
			<p class="mb-3 text-sm text-red-400">{problem}</p>
		{/if}

		{#if links.waiting.length}
			<p class="mb-2 text-sm text-zinc-400">
				Mándalo a alguien mayor de la otra familia, o enséñale el QR para que lo lea con la cámara
				de su móvil. Vale una vez, durante 7 días.
			</p>
			<ul class="divide-y divide-zinc-800">
				{#each links.waiting as w (w.id)}
					<li class="py-2">
						<div class="flex flex-wrap items-center gap-2">
							<span class="w-full text-sm text-zinc-300 sm:w-auto sm:flex-1">
								Enlace
								<span class="text-zinc-500">
									{w.expired ? '· caducado' : `· vale hasta el ${day(w.expiresAt)}`}
								</span>
							</span>
							{#if !w.expired}
								<button class={secondary} onclick={() => share(w.link)}>
									{copied === w.link ? 'Copiado' : 'Enviar'}
								</button>
								<button
									class={secondary}
									onclick={() => (shownQr = shownQr === w.link ? null : w.link)}
								>
									{shownQr === w.link ? 'Ocultar QR' : 'QR'}
								</button>
							{/if}
							<form method="post" action="?seccion={tab}&/unlinkFamily" use:enhance>
								<input type="hidden" name="id" value={w.id} />
								<button class={secondary}>{w.expired ? 'Quitar' : 'Cancelar'}</button>
							</form>
						</div>
						{#if shownQr === w.link && !w.expired}
							<img
								src={w.qr}
								alt="QR del enlace para vincular"
								class="mt-3 h-56 w-56 rounded-md bg-white"
							/>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}
