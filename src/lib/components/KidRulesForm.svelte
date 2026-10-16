<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { clock, WEEKDAYS, type KidRules } from '#lib/kid-time.ts';

	/** A child's schedule and daily limit (#18), edited whole and saved with `?/rules`. */
	let {
		userId,
		rules,
		message,
		saved
	}: { userId: string; rules: KidRules; message?: string; saved?: boolean } = $props();

	type Row = { start: string; end: string };
	/** `<input type="time">` wants `07:05`. */
	const time = (minute: number) => (minute >= 1440 ? '23:59' : clock(minute).padStart(5, '0'));

	const fromRules = () =>
		WEEKDAYS.map((_, day) =>
			rules.slots
				.filter((s) => s.weekday === day)
				.map((s) => ({ start: time(s.startMinute), end: time(s.endMinute) }))
		);
	let days = $state<Row[][]>(fromRules());
	// What was saved, to edit: the form keeps its own copy.
	let dailyMinutes = $state<number | null>(untrack(() => rules.dailyMinutes));
	const hasSlots = $derived(days.some((rows) => rows.length));

	/** The slots of `from` to every day in `to`. */
	function copy(from: number, to: number[]) {
		for (const day of to) if (day !== from) days[day] = days[from].map((row) => ({ ...row }));
	}

	const small = 'rounded-md border-zinc-700 bg-zinc-900 py-1 text-sm';
	const link = 'text-xs text-zinc-400 hover:text-white';
</script>

<form
	method="post"
	action="?/rules"
	use:enhance={() =>
		async ({ update }) =>
			update({ reset: false })}
	class="space-y-4 text-sm"
>
	<input type="hidden" name="userId" value={userId} />
	{#each days as rows, day (day)}
		{#each rows as row, i (i)}
			<input type="hidden" name="slot" value="{day}|{row.start}|{row.end}" />
		{/each}
	{/each}

	<p class="text-zinc-400">
		Cuándo puede ver series y películas; la radio y la música, siempre. Sin ningún tramo, a
		cualquier hora. Con alguno, el día que no tenga tramos no hay vídeo.
	</p>

	<ul class="divide-y divide-zinc-800 rounded-md border border-zinc-800">
		{#each WEEKDAYS as name, day (day)}
			<li class="flex flex-wrap items-center gap-2 p-2">
				<span class="w-24 shrink-0 capitalize">{name}</span>
				{#each days[day] as row, i (i)}
					<span class="flex items-center gap-1">
						<input
							type="time"
							bind:value={row.start}
							required
							aria-label="Desde, el {name}"
							class={small}
						/>
						–
						<input
							type="time"
							bind:value={row.end}
							required
							aria-label="Hasta, el {name}"
							class={small}
						/>
						<button
							type="button"
							class="rounded-md px-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
							aria-label="Quitar este tramo del {name}"
							onclick={() => days[day].splice(i, 1)}>×</button
						>
					</span>
				{:else}
					<span class="text-zinc-500">{hasSlots ? 'Sin vídeo' : 'A cualquier hora'}</span>
				{/each}
				<button
					type="button"
					class="ml-auto {link}"
					onclick={() => days[day].push({ start: '17:00', end: '19:00' })}>+ tramo</button
				>
				{#if day === 0 && days[0].length}
					<button type="button" class={link} onclick={() => copy(0, [1, 2, 3, 4])}
						>Igual de martes a viernes</button
					>
				{:else if day === 5 && days[5].length}
					<button type="button" class={link} onclick={() => copy(5, [6])}>Igual el domingo</button>
				{/if}
			</li>
		{/each}
	</ul>

	<label class="flex flex-wrap items-center gap-2">
		Como mucho
		<input
			type="number"
			name="dailyMinutes"
			min="0"
			max="1440"
			step="5"
			bind:value={dailyMinutes}
			placeholder="sin límite"
			class="{small} w-28"
		/>
		minutos de vídeo al día
	</label>

	<div class="flex items-center gap-3">
		<button class="rounded-md bg-amber-500 px-3 py-1 font-medium text-zinc-950 hover:bg-amber-400"
			>Guardar horario</button
		>
		{#if message}
			<span class="text-red-400">{message}</span>
		{:else if saved}
			<span class="text-amber-400">✓ Guardado</span>
		{/if}
	</div>
</form>
