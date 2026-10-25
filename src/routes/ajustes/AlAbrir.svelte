<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from './styles.ts';
	import type { PageData } from './$types';

	/** Al abrir la app: una frase de tus series. */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

<section class={section} id="al-abrir">
	<h2 class="mb-1 font-semibold">Al abrir la app</h2>
	<form
		method="post"
		action="?seccion={tab}&/openingQuote"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<label class="flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				name="openingQuote"
				checked={data.openingQuoteOn}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
			/>
			<span>
				Una frase de tus series
				<span class="block text-xs text-zinc-500"
					>Unos segundos, en blanco sobre negro, como los rótulos de Frasier entre escenas. Sale de
					los subtítulos, mejor de la serie que estás viendo{data.ai?.keySource
						? ', y la IA elige las más ingeniosas'
						: ''}. Cualquier tecla o toque la quita.</span
				>
			</span>
		</label>
	</form>
</section>
