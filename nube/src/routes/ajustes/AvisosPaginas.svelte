<script lang="ts">
	import { enhance } from '$app/forms';
	import { PAGE_NOTICE_KINDS, type PageNoticeKind } from 'comun/page-notices.ts';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Avisos en las páginas (#440): en amarillo, por reglas y sin IA, como un ticket subido dos
	 * veces. De toda la familia, encendidos de inicio; cada tipo, apagado con «No me lo vuelvas a
	 * decir» y encendido otra vez aquí. Cualquier adulto, como ese botón.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();

	const kinds = Object.entries(PAGE_NOTICE_KINDS) as [PageNoticeKind, string][];
</script>

<section class={section} id="avisos-paginas">
	<h2 class="mb-1 font-semibold">Avisos en las páginas</h2>
	<form
		method="post"
		action="?seccion={tab}&/savePageNotices"
		class="flex flex-col gap-2"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<label class="flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				name="on"
				checked={data.pageNotices.on}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
			/>
			<span>
				Avisar en las páginas de lo que parece un descuido
				<span class="block text-xs text-zinc-500"
					>En amarillo, por reglas fijas, sin IA y sin gastar saldo: por ejemplo, un ticket o una
					factura subidos dos veces.</span
				>
			</span>
		</label>
		{#if data.pageNotices.on}
			{#each kinds as [kind, label] (kind)}
				<label class="ml-6 flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						name="kind"
						value={kind}
						checked={!data.pageNotices.off.includes(kind)}
						onchange={(e) => e.currentTarget.form?.requestSubmit()}
						class="rounded border-zinc-700 bg-zinc-900 text-amber-500"
					/>
					{label}
				</label>
			{/each}
			<!-- Those unticked go off; sent so that the server knows which were shown. -->
			{#each kinds as [kind] (kind)}<input type="hidden" name="shown" value={kind} />{/each}
		{/if}
	</form>
</section>
