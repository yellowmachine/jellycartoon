<script lang="ts">
	interface Props {
		path: string;
		label: string;
	}

	let { path, label }: Props = $props();

	let copied = $state(false);
	/** The clipboard only works over https or localhost: otherwise the path is shown to copy by hand. */
	let showing = $state(false);
	let input = $state<HTMLInputElement>();
	$effect(() => input?.select());

	async function copy() {
		if (window.isSecureContext && navigator.clipboard) {
			try {
				await navigator.clipboard.writeText(path);
				copied = true;
				setTimeout(() => (copied = false), 1500);
				return;
			} catch {
				// Denied: fall back to showing it.
			}
		}
		showing = true;
	}
</script>

<div class="relative shrink-0">
	<button
		class="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-white"
		title={label}
		aria-label={label}
		onclick={copy}>{copied ? '✓' : '⧉'}</button
	>
	{#if showing}
		<div
			class="absolute top-full right-0 z-10 mt-1 w-96 max-w-[80vw] rounded-md border border-zinc-700 bg-zinc-900 p-2 shadow-lg"
		>
			<input
				bind:this={input}
				readonly
				value={path}
				aria-label={label}
				onblur={() => (showing = false)}
				onkeydown={(e) => e.key === 'Escape' && (showing = false)}
				class="w-full rounded border-zinc-700 bg-zinc-950 py-1 font-mono text-xs"
			/>
			<p class="mt-1 text-xs text-zinc-400">Ctrl+C para copiar</p>
		</div>
	{/if}
</div>
