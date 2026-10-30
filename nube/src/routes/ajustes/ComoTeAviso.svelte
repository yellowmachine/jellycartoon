<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * «Cómo te aviso» (#331): lo que la app te dice queda en tu Buzón y te llega al móvil (si este
	 * aparato tiene los avisos, en «Este aparato»); los recados, también por correo si lo quieres.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();
</script>

<section class={section} id="como-te-aviso">
	<h2 class="mb-1 font-semibold">Cómo te aviso</h2>
	<p class="mb-3 text-sm text-zinc-400">
		Todo lo que te avisa la app (la Agenda, las alarmas, la medicación, los recados) queda en tu
		<a href="/buzon" class="text-amber-400 hover:underline">Buzón</a>, y te llega al móvil si lo
		tienes en «Este aparato». Lo urgente, además, por correo siempre.
	</p>
	<form
		method="post"
		action="?seccion={tab}&/inboxByEmail"
		use:enhance={() =>
			async ({ update }) =>
				update({ reset: false })}
	>
		<label class="flex items-start gap-2 text-sm">
			<input
				type="checkbox"
				name="inboxByEmail"
				checked={data.inboxByEmail}
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
				class="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500"
			/>
			<span>
				Los recados, también por correo
				<span class="block text-xs text-zinc-500"
					>Cuando alguien te deja uno («Alexa, déjale un recado a…» o desde su Buzón), te llega
					además a tu correo.</span
				>
			</span>
		</label>
	</form>
</section>
