<script lang="ts">
	import { deserialize } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { signOrder, type SatelliteTrust } from '#lib/enchufes/firma.ts';
	import { primary, section } from '#lib/styles.ts';
	import type { SatelliteRule } from 'comun/plug-rules.ts';

	/**
	 * The plug rules each satellite can do by itself (#651): how many, whether it has them, and, if
	 * they changed, a button for this device to sign them (only if it is given to that satellite).
	 * Said to the satellite, a rule goes without signing.
	 */
	type State = {
		id: string;
		name: string;
		fp: string;
		count: number;
		asked: number;
		kept: boolean;
		toSign: { version: number; rules: SatelliteRule[] } | null;
	};
	let { states, devices }: { states: State[]; devices: SatelliteTrust[] } = $props();

	let busy = $state<string | null>(null);
	let problem = $state<{ id: string; text: string } | null>(null);
	const canSign = (s: State) => devices.some((d) => d.fp === s.fp);

	async function sign(s: State) {
		if (!s.toSign) return;
		busy = s.id;
		problem = null;
		try {
			const order = await signOrder(s.fp, null, 'Satelite.Reglas', s.toSign);
			if (!order) {
				problem = { id: s.id, text: 'Este aparato no está dado de alta en ese satélite' };
				return;
			}
			const body = new FormData();
			body.set('id', s.id);
			body.set('signed', JSON.stringify(order));
			const res = await fetch('?/signRules', {
				method: 'POST',
				body,
				headers: { 'x-sveltekit-action': 'true' }
			});
			const result = deserialize(await res.text());
			if (result.type === 'failure')
				problem = { id: s.id, text: String(result.data?.problem ?? 'No se pudo') };
			else if (result.type === 'error') problem = { id: s.id, text: 'No se pudo' };
			await invalidateAll();
		} finally {
			busy = null;
		}
	}
</script>

{#if states.some((s) => s.count || s.toSign)}
	<section class={section}>
		<h2 class="mb-1 font-semibold">Reglas en los satélites</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Las reglas que encienden o apagan un enchufe las guarda el satélite por el que pasa. Las de
			una hora, o de cuando otro enchufe acaba, las hace él solo, también sin internet. Las que
			dependen de algo que sabe Seilide (el tiempo, si llegas a casa…) las hace cuando Seilide se lo
			pide, y solo lo que firmaste. Las firma un aparato dado de alta en él; las que le dices al
			propio satélite no hace falta firmarlas.
		</p>
		<ul class="divide-y divide-zinc-800 text-sm">
			{#each states as s (s.id)}
				<li class="flex flex-wrap items-center justify-between gap-2 py-2">
					<span>
						{s.name}
						<span class="block text-xs text-zinc-500">
							{s.count === 1 ? '1 regla' : `${s.count} reglas`}
							{#if s.asked}({s.asked === s.count
									? s.asked === 1
										? 'la pide Seilide'
										: 'todas las pide Seilide'
									: `${s.asked} las pide Seilide`}){/if}
							{#if s.toSign}· cambiadas, sin firmar{:else if s.kept}· las tiene ✓{:else}· aún no las
								ha tomado{/if}
						</span>
					</span>
					{#if s.toSign}
						{#if canSign(s)}
							<button class={primary} disabled={busy === s.id} onclick={() => sign(s)}>
								{busy === s.id ? 'Firmando…' : 'Firmar'}
							</button>
						{:else}
							<span class="text-xs text-zinc-500">Fírmalas desde un aparato dado de alta</span>
						{/if}
					{/if}
					{#if problem?.id === s.id}
						<p class="w-full text-xs text-red-400">{problem.text}</p>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
