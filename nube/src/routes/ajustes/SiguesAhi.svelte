<script lang="ts">
	import { enhance } from '$app/forms';
	import { ANSWER_SECONDS, ASK_AFTER_OPTIONS, askAfterLabel } from 'comun/still-there.ts';

	/**
	 * «¿Sigues ahí?» (#77), kept at home as there (Ajustes → Reproducción, /infantil): theirs, or a
	 * child's (`kidId`), for who runs the family.
	 */
	let {
		value,
		tab,
		kidId = null,
		problem = null
	}: {
		value: number | null;
		tab: string;
		kidId?: string | null;
		problem?: string | null;
	} = $props();

	const ASK: { value: number | null; label: string }[] = [
		{ value: null, label: 'Nunca' },
		...ASK_AFTER_OPTIONS.map((n) => ({ value: n, label: `Tras ${askAfterLabel(n)}` }))
	];
</script>

<form
	method="post"
	action="?seccion={tab}&/askAfter"
	use:enhance={() =>
		async ({ update }) =>
			update({ reset: false })}
	class="text-sm"
>
	{#if kidId}<input type="hidden" name="kidId" value={kidId} />{/if}
	<div class="flex flex-wrap items-center gap-2">
		<span class="mr-1">Preguntar «¿Sigues ahí?»</span>
		{#each ASK as option (option.value)}
			<button
				name="askAfter"
				value={option.value ?? ''}
				aria-pressed={value === option.value}
				class={[
					'rounded-full border px-3 py-1',
					value === option.value
						? 'border-amber-500 text-amber-400'
						: 'border-zinc-700 hover:bg-zinc-900'
				]}>{option.label}</button
			>
		{/each}
	</div>
	<p class="mt-1 text-xs text-zinc-500">
		Con «siguiente automático» en las series, cuando pasa ese tiempo sin tocar nada, el capítulo que
		está sonando acaba y el siguiente espera a que {kidId ? 'contesten' : 'contestes'}; si en
		{ANSWER_SECONDS / 60} minutos nadie lo hace, se para. Es el mismo que en casa.
	</p>
	{#if problem}<p class="mt-1 text-red-400">{problem}</p>{/if}
</form>
