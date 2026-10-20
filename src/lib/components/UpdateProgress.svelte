<script lang="ts">
	import { onMount } from 'svelte';
	import { nextStep } from '#lib/update-progress.ts';

	/**
	 * While WUD updates (#20): over the page of whoever asked, so that nothing is lost in the seconds
	 * the app restarts. It follows /api/health, which says which version answers: the new one is
	 * success (the page loads it, and Ajustes says so); the old one again after going down is WUD
	 * having gone back to it. Other devices only notice a few seconds and connect again by themselves.
	 */
	let { current, target }: { current: string; target: string } = $props();

	/** What Ajustes shows after loading the new version. */
	const DONE_KEY = 'jellycartoon:updated';
	/** Asked this often. */
	const EVERY_MS = 3000;

	let stage = $state<'preparing' | 'restarting' | 'finishing'>('preparing');
	let failure = $state<string | null>(null);
	let dialog = $state<HTMLDialogElement>();
	/** «Cerrar» after a failure: the only way out on purpose. */
	let closedByUser = false;

	onMount(() => {
		// Modal: the page behind cannot be used, and Escape (the remote's «back») does not leave it.
		dialog?.showModal();
		const started = Date.now();
		let wentDown = false;
		/** When the new version first answered. */
		let upSince: number | null = null;
		let timer: ReturnType<typeof setTimeout>;

		/** How many containers WUD has left; undefined if it could not be asked (Caddy restarting). */
		async function pendingUpdates(): Promise<number | null | undefined> {
			try {
				const res = await fetch('/api/update-status', { cache: 'no-store' });
				if (res.ok) return (await res.json()).pending;
			} catch {
				// Nothing answers.
			}
			return undefined;
		}

		async function check() {
			let version: string | null = null;
			try {
				const res = await fetch('/api/health', { cache: 'no-store' });
				if (res.ok) version = (await res.json()).version;
			} catch {
				// Restarting: nothing answers for a few seconds.
			}
			if (version === null) wentDown = true;
			// After the app, WUD goes on with the rest; while Caddy restarts the page reaches nothing.
			const pending = version === target ? await pendingUpdates() : undefined;
			if (version === target) upSince ??= Date.now();
			const step = nextStep(version, {
				target,
				wentDown,
				elapsedMs: Date.now() - started,
				pending,
				upForMs: upSince === null ? 0 : Date.now() - upSince
			});
			if (step.kind === 'done') {
				try {
					sessionStorage.setItem(DONE_KEY, JSON.stringify({ from: current, to: target }));
				} catch {
					// Private window: it updates all the same, without the message after.
				}
				location.reload();
				return;
			}
			if (step.kind === 'failed') {
				failure = step.message;
				return;
			}
			stage = step.stage;
			timer = setTimeout(check, EVERY_MS);
		}

		timer = setTimeout(check, EVERY_MS);
		return () => clearTimeout(timer);
	});
</script>

<dialog
	bind:this={dialog}
	class="m-auto w-[calc(100%-2rem)] max-w-md bg-transparent p-0 backdrop:bg-zinc-950/90 backdrop:backdrop-blur"
	aria-labelledby="update-title"
	oncancel={(e) => {
		// While it updates, Escape does nothing; with the failure shown, it closes.
		if (!failure) e.preventDefault();
	}}
	onclose={() => {
		// Chrome closes it on Escape anyway when there was no click before: open again.
		if (!failure && !closedByUser) dialog?.showModal();
	}}
>
	<div aria-live="polite">
		<div class="w-full max-w-md rounded-md border border-zinc-800 bg-zinc-900 p-6 text-center">
			{#if failure}
				<p id="update-title" class="mb-2 text-lg font-semibold text-red-400">
					No se ha actualizado
				</p>
				<p class="text-sm text-zinc-300">{failure}</p>
				<div class="mt-5 flex justify-center gap-2">
					<a
						href="/logs"
						class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
						>Ver el Registro</a
					>
					<button
						type="button"
						class="rounded-md bg-amber-500 px-3 py-1 text-sm font-medium text-zinc-950 hover:bg-amber-400"
						onclick={() => {
							closedByUser = true;
							dialog?.close();
						}}>Cerrar</button
					>
				</div>
			{:else}
				<div
					class="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-amber-400 motion-reduce:animate-none"
					aria-hidden="true"
				></div>
				<p id="update-title" class="mb-2 text-lg font-semibold">Actualizando a la {target}</p>
				<p class="text-sm text-zinc-300">
					{stage === 'preparing'
						? 'Copia de la base de datos y descarga de la versión nueva.'
						: stage === 'restarting'
							? 'Reiniciando la app. Vuelve en unos segundos.'
							: 'La app ya está. Falta el resto (Caddy, Snapcast…): unos segundos más.'}
				</p>
				<p class="mt-3 text-xs text-zinc-500">
					Puede tardar unos minutos. No cierres esta página: se recargará sola al terminar.
				</p>
			{/if}
		</div>
	</div>
</dialog>
