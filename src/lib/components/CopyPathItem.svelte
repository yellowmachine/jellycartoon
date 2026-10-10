<script lang="ts">
	import { menuItem } from './menu.ts';

	interface Props {
		path: string;
		label: string;
		/** Closes the menu once copied. */
		onclose: () => void;
	}

	let { path, label, onclose }: Props = $props();

	let root = $state<HTMLElement>();
	let copied = $state(false);
	/** The clipboard only works over https or localhost: otherwise the path is shown to copy by hand. */
	let showing = $state(false);
	let input = $state<HTMLInputElement>();
	$effect(() => input?.select());

	// Hidden again whenever the menu closes.
	$effect(() => {
		const menu = root?.closest('[popover]');
		const reset = (e: Event) => (e as ToggleEvent).newState === 'closed' && (showing = false);
		menu?.addEventListener('toggle', reset);
		return () => menu?.removeEventListener('toggle', reset);
	});

	async function copy() {
		if (window.isSecureContext && navigator.clipboard) {
			try {
				await navigator.clipboard.writeText(path);
				copied = true;
				setTimeout(() => {
					copied = false;
					onclose();
				}, 800);
				return;
			} catch {
				// Denied: fall back to showing it.
			}
		}
		showing = true;
	}
</script>

<div bind:this={root}>
	<button class={menuItem} onclick={copy}>{copied ? '✓ Ruta copiada' : label}</button>
	{#if showing}
		<div class="px-3 pb-2">
			<input
				bind:this={input}
				readonly
				value={path}
				aria-label="Ruta"
				class="w-full rounded border-zinc-700 bg-zinc-950 py-1 font-mono text-xs"
			/>
			<p class="mt-1 text-xs text-zinc-400">Ctrl+C para copiar</p>
		</div>
	{/if}
</div>
