<script lang="ts">
	import { enhance } from '$app/forms';
	import Dibujo from 'comun/components/Dibujo.svelte';
	import SectionIcon, { type Section } from 'comun/components/SectionIcon.svelte';
	import { field } from '#lib/styles.ts';

	/** What «Pedir acceso» answered: asked, or what was typed back with what is wrong. */
	let {
		form
	}: {
		form?: {
			asked?: boolean;
			name?: string;
			email?: string;
			message?: string | null;
			error?: string;
		} | null;
	} = $props();

	const FEATURES: { icon: Section; title: string; text: string }[] = [
		{
			icon: 'nevera',
			title: 'Nevera',
			text: 'Post-its para todos y la lista de la compra, que se tacha en el súper.'
		},
		{ icon: 'recetas', title: 'Recetas', text: 'El recetario de la familia, a mano en la cocina.' },
		{
			icon: 'agenda',
			title: 'Agenda',
			text: 'Cumpleaños, citas y alarmas, con aviso en el móvil y en el calendario de cada uno.'
		},
		{
			icon: 'gastos',
			title: 'Gastos',
			text: 'Haz una foto al ticket y se apunta solo, con los gastos fijos de cada mes.'
		},
		{
			icon: 'viajes',
			title: 'Viajes',
			text: 'El modo carretera: la radio, tus podcasts y tus sitios guardados, en el coche.'
		},
		{
			icon: 'musica',
			title: 'Tu casa',
			text: 'Si tienes un servidor en casa, su música y sus series, también fuera.'
		}
	];

	let sending = $state(false);
</script>

<div class="mx-auto max-w-4xl">
	<header class="flex items-center justify-between">
		<span class="text-xl font-bold text-amber-400">Seilide</span>
		<a href="/login" class="rounded-md border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-900">
			Entrar
		</a>
	</header>

	<section class="py-16 text-center sm:py-24">
		<!-- The snail on its way, the trail back to the house: the house, carried along. -->
		<Dibujo name="portada" class="mx-auto mb-8 max-w-md text-zinc-100" />
		<h1 class="text-4xl font-bold sm:text-5xl">Las cosas de casa, en un solo sitio</h1>
		<p class="mx-auto mt-4 max-w-2xl text-lg text-zinc-400">
			La nevera, las recetas, la agenda y los gastos de tu familia, desde el móvil de cada uno. Y se
			le puede hablar: «apunta leche en la lista».
		</p>
		<a
			href="#pedir"
			class="mt-8 inline-block rounded-md bg-amber-500 px-5 py-2.5 font-medium text-zinc-950 hover:bg-amber-400"
		>
			Pedir acceso
		</a>
	</section>

	<section class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each FEATURES as f (f.title)}
			<div class="rounded-md border border-zinc-800 p-4">
				<SectionIcon name={f.icon} class="h-7 w-7 text-amber-400" />
				<h2 class="mt-2 font-semibold">{f.title}</h2>
				<p class="text-sm text-zinc-400">{f.text}</p>
			</div>
		{/each}
	</section>

	<section class="mt-12 rounded-md border border-zinc-800 p-6 text-zinc-400">
		<h2 class="mb-2 font-semibold text-zinc-100">Cada familia, lo suyo</h2>
		<p class="text-sm">
			Lo de tu familia solo lo ve tu familia: la base de datos separa a cada una por sí misma, no
			por un filtro que alguien pueda olvidar. Entra quien invitas, con verificación en dos pasos si
			quiere.
		</p>
	</section>

	<section id="pedir" class="mx-auto mt-16 mb-24 max-w-md scroll-mt-8">
		<h2 class="text-center text-2xl font-bold">Pedir acceso</h2>
		{#if form?.asked}
			<p class="mt-6 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
				¡Apuntado! Te hemos mandado un correo, y cuando tengas acceso te llegará otro con el enlace
				para crear tu familia.
			</p>
		{:else}
			<p class="mt-2 mb-6 text-center text-sm text-zinc-400">
				De momento entran pocas familias. Déjanos tu email y te escribimos.
			</p>
			<form
				method="post"
				action="?/ask"
				class="space-y-4"
				use:enhance={() => {
					sending = true;
					return async ({ update }) => {
						await update();
						sending = false;
					};
				}}
			>
				<label class="block text-sm">
					Nombre
					<input
						name="name"
						required
						maxlength={100}
						autocomplete="name"
						value={form?.name ?? ''}
						class="mt-1 {field}"
					/>
				</label>
				<label class="block text-sm">
					Email
					<input
						type="email"
						name="email"
						required
						maxlength={200}
						autocomplete="email"
						value={form?.email ?? ''}
						class="mt-1 {field}"
					/>
				</label>
				<label class="block text-sm">
					¿Para qué la usaríais? <span class="text-zinc-500">(si quieres)</span>
					<textarea name="message" rows="3" maxlength={2000} class="mt-1 {field}"
						>{form?.message ?? ''}</textarea
					>
				</label>
				<!-- Only robots see it, and fill it in (+page.server.ts). -->
				<input name="web" tabindex="-1" autocomplete="off" aria-hidden="true" class="hidden" />
				{#if form?.error}
					<p class="text-sm text-red-400">{form.error}</p>
				{/if}
				<button
					disabled={sending}
					class="w-full rounded-md bg-amber-500 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
				>
					{sending ? 'Enviando…' : 'Pedir acceso'}
				</button>
			</form>
			<p class="mt-4 text-center text-sm text-zinc-400">
				¿Ya tienes invitación? <a href="/login" class="text-amber-400 hover:underline"
					>Crea tu cuenta</a
				>
			</p>
		{/if}
	</section>
</div>
