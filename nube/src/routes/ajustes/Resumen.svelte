<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import { SUMMARY_BLOCKS, type SummaryBlock } from '#lib/summary.ts';

	import type { PageData } from './$types';

	/** What Preguntar → Resumen tells them, and its card on the home page. */
	let { data, tab }: { data: PageData; tab: string } = $props();
	const noticeOn = $derived(data.summaryChoice.notice.length > 0);

	const blocks = Object.entries(SUMMARY_BLOCKS) as [SummaryBlock, { label: string }][];
	const box = 'rounded border-zinc-700 bg-zinc-900 text-amber-500';
	const submit = (e: Event & { currentTarget: HTMLInputElement }) =>
		e.currentTarget.form?.requestSubmit();
</script>

<section class={section} id="resumen">
	<h2 class="mb-1 font-semibold">Resumen</h2>
	<form
		method="post"
		action="?seccion={tab}&/saveSummary"
		class="flex flex-col gap-2 text-sm"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<label class="flex items-start gap-2">
			<input
				type="checkbox"
				name="card"
				checked={data.summaryChoice.card}
				onchange={submit}
				class="mt-0.5 {box}"
			/>
			<span>
				«Tus últimos 7 días» en la portada
				<span class="block text-xs text-zinc-500"
					>El resumen entero, también de semanas y meses, en <a
						href="/preguntar/resumen"
						class="text-amber-400 hover:underline">Preguntar → Resumen</a
					>.</span
				>
			</span>
		</label>
		<label class="flex items-start gap-2">
			<input
				type="checkbox"
				name="notice"
				checked={noticeOn}
				onchange={submit}
				class="mt-0.5 {box}"
			/>
			<span>
				Avisarme en el Buzón cuando acabe una semana o un mes
				<span class="block text-xs text-zinc-500"
					>Con lo principal y el enlace para verlo o guardarlo como informe. Solo en el Buzón, sin
					aviso en el móvil.</span
				>
			</span>
		</label>
		{#if noticeOn}
			<div class="ml-6 flex flex-wrap gap-x-4 gap-y-2">
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						name="noticeView"
						value="semana"
						checked={data.summaryChoice.notice.includes('semana')}
						onchange={submit}
						class={box}
					/>
					Cada semana, el lunes
				</label>
				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						name="noticeView"
						value="mes"
						checked={data.summaryChoice.notice.includes('mes')}
						onchange={submit}
						class={box}
					/>
					Cada mes, el día 1
				</label>
			</div>
		{/if}
		<fieldset class="flex flex-col gap-2">
			<legend class="mb-2 text-zinc-400">Qué cuenta:</legend>
			{#each blocks as [block, { label }] (block)}
				<label class="ml-6 flex items-center gap-2">
					<input
						type="checkbox"
						name="block"
						value={block}
						checked={!data.summaryChoice.off.includes(block)}
						onchange={submit}
						class={box}
					/>
					{label}
				</label>
			{/each}
		</fieldset>
	</form>
</section>
