<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		acceptEnrolment,
		enrolRequest,
		forget,
		leaveOrder,
		parseCode,
		type SatelliteTrust
	} from '#lib/enchufes/firma.ts';
	import { field, primary, section } from '#lib/styles.ts';

	/**
	 * This device given to the family's satellite (#643): «añade un aparato» said to it, its page
	 * in the home's wifi shows a code, pasted here. The code itself never leaves this device: only
	 * its key and a MAC made with it go to Seilide, and the satellite's answer is checked here.
	 */
	let {
		devices,
		enrolment,
		pages,
		onchange
	}: {
		devices: SatelliteTrust[];
		/** The window open now, if Seilide knows of it: which satellite, its page, until when. */
		enrolment: { satellite: string; url: string | null; until: number } | null;
		/** Each satellite's page, as it last said: linked even while closed. */
		pages: { satellite: string; url: string }[];
		onchange: () => void;
	} = $props();

	let code = $state('');
	let name = $state('');
	let problem = $state<string | null>(null);
	let sending = $state(false);
	/** Why taking it off the satellite did not work, for which. */
	let leaving = $state<{ fp: string; problem: string } | null>(null);
	const clock = new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' });
</script>

<section class="{section} mb-6">
	<h2 class="mb-2 font-semibold">Este aparato</h2>
	{#if devices.length}
		{#each devices as d (d.fp)}
			<p class="text-sm text-emerald-300">
				✓ Dado de alta en el satélite «{d.name}» como «{d.as}»: enciende y apaga con su firma.
			</p>
			<!-- Taken off the satellite's list by its own signature, then forgotten here. -->
			<form
				method="post"
				action="?/forget"
				use:enhance={async ({ formData, cancel }) => {
					leaving = null;
					const order = await leaveOrder(d.fp);
					if (!order) {
						await forget(d.fp);
						onchange();
						return cancel();
					}
					formData.set('envelope', order.envelope);
					formData.set('sig', order.sig);
					return async ({ result }) => {
						if (result.type === 'success') {
							await forget(d.fp);
							onchange();
							return;
						}
						leaving = {
							fp: d.fp,
							problem: String(
								(result.type === 'failure' && result.data?.forgetProblem) || 'No se pudo'
							)
						};
					};
				}}
			>
				<button class="mt-1 text-xs text-zinc-500 hover:text-red-400"
					>Quitar este aparato del satélite</button
				>
			</form>
			{#if leaving?.fp === d.fp}
				<p class="text-xs text-red-300">
					{leaving.problem}.
					<button
						type="button"
						class="underline"
						onclick={async () => {
							await forget(d.fp);
							leaving = null;
							onchange();
						}}>Olvidarlo solo aquí</button
					>
					(seguirá en la lista del satélite: quítalo en su página con el alta abierta).
				</p>
			{/if}
		{/each}
	{:else}
		<p class="mb-3 text-sm text-zinc-300">
			Los enchufes van por el satélite de casa, que solo obedece a los aparatos dados de alta. Para
			encender y apagar desde este:
		</p>
		<ol class="mb-3 list-decimal space-y-1 pl-5 text-sm text-zinc-300">
			<li>Dile al satélite <b>«añade un aparato»</b>.</li>
			<li>
				Dentro de la wifi de casa, abre su página
				{#if enrolment?.url}
					(<a
						href={enrolment.url}
						target="_blank"
						rel="noopener"
						class="text-amber-400 hover:underline">{enrolment.url}</a
					>, abierta hasta las {clock.format(new Date(enrolment.until))})
				{:else if pages.length}
					{#each pages as p, i (p.url)}{i ? ', ' : ' '}<a
							href={p.url}
							target="_blank"
							rel="noopener"
							class="text-amber-400 hover:underline">{p.url}</a
						>{pages.length > 1 ? ` (${p.satellite})` : ''}{/each}
				{:else}
					(<code>http://&lt;IP del satélite&gt;:8790/alta</code>)
				{/if}
				y copia el código.
			</li>
			<li>Pégalo aquí.</li>
		</ol>
		<form
			method="post"
			action="?/enrol"
			class="grid gap-2"
			use:enhance={async ({ formData, cancel }) => {
				problem = null;
				const request = parseCode(code) ? await enrolRequest(code, name.trim() || 'Aparato') : null;
				if (!request) {
					problem = 'Ese no es el código de la página del satélite';
					return cancel();
				}
				sending = true;
				formData.set('publicKey', request.publicKey);
				formData.set('name', request.name);
				formData.set('mac', request.mac);
				return async ({ result }) => {
					sending = false;
					if (result.type === 'failure') {
						problem = String(result.data?.enrolProblem ?? result.data?.problem ?? 'No se pudo');
						return;
					}
					if (result.type !== 'success' || !result.data?.enrolled) {
						problem = 'No se pudo';
						return;
					}
					const ok = await acceptEnrolment(
						request.satellite,
						result.data.enrolled as { fp: string; satellite: string; ack: string },
						{ satellite: String(result.data.satelliteName ?? 'Satélite'), as: request.name }
					);
					if (!ok) {
						problem =
							'La respuesta no viene del satélite del código: no se ha guardado. Prueba otra vez.';
						return;
					}
					code = '';
					onchange();
				};
			}}
		>
			<input
				bind:value={name}
				maxlength="40"
				placeholder="Cómo se llama este aparato (Móvil de Ana)"
				class={field}
			/>
			<!-- No `name`: the code never goes in the form, only what it makes here. -->
			<textarea
				bind:value={code}
				rows="2"
				placeholder="Código de la página del satélite"
				class="{field} font-mono text-xs"
				autocomplete="off"></textarea>
			{#if problem}<p class="text-sm text-red-300">{problem}</p>{/if}
			<button class="{primary} justify-self-start" disabled={sending}
				>{sending ? 'Dando de alta…' : 'Dar de alta este aparato'}</button
			>
		</form>
	{/if}
</section>
