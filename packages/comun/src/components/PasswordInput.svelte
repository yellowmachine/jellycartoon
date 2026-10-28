<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	/**
	 * A password field with an eye on its right to see what is being typed, and hide it again. The
	 * rest of its attributes (name, autocomplete, required…) go to the input; `box`, the classes of
	 * the box around both (e.g. its margin, so the eye stays centred on the input).
	 */
	let {
		class: className = '',
		box = '',
		...rest
	}: Omit<HTMLInputAttributes, 'type'> & { box?: string } = $props();
	let shown = $state(false);
</script>

<div class="relative {box}">
	<input {...rest} type={shown ? 'text' : 'password'} class="{className} pr-10" />
	<button
		type="button"
		class="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-zinc-400 hover:text-zinc-100 focus-visible:text-amber-400"
		aria-label={shown ? 'Ocultar la contraseña' : 'Ver la contraseña'}
		aria-pressed={shown}
		title={shown ? 'Ocultar la contraseña' : 'Ver la contraseña'}
		onclick={() => (shown = !shown)}
	>
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="h-5 w-5"
			aria-hidden="true"
		>
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
			<circle cx="12" cy="12" r="3" />
			{#if shown}
				<path d="M4 4l16 16" />
			{/if}
		</svg>
	</button>
</div>
