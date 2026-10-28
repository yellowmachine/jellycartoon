<script lang="ts">
	import { AVATARS } from 'comun/avatars.ts';

	/**
	 * The drawings to choose from (#141, #157): a child's, an adult's, one's own; in the cloud, a
	 * person's of the family (#253).
	 */
	let { chosen, label }: { chosen: string | null; label: string } = $props();
</script>

<div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
	{#each AVATARS as a (a.id)}
		<label class="cursor-pointer rounded-full ring-amber-400 has-checked:ring-2" title={a.id}>
			<input type="radio" name="avatar" value={a.id} checked={a.id === chosen} class="sr-only" />
			<span class="flex h-9 w-9 items-center justify-center rounded-full text-xl {a.color}"
				>{a.emoji}</span
			>
		</label>
	{/each}
</div>
