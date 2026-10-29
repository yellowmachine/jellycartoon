<script lang="ts">
	import { enhance } from '$app/forms';
	import { section } from '#lib/styles.ts';
	import type { PageData } from './$types';

	/**
	 * Lo que ha aprendido la voz de sus preguntas, por sitio (un satélite, una persona): para ver por
	 * qué ya no pregunta algo, y olvidarlo si lo aprendió mal.
	 */
	let { data, tab }: { data: PageData; tab: string } = $props();

	const byPlace = $derived(
		Object.entries(Object.groupBy(data.voiceLearned ?? [], (l) => l.placeName))
	);
</script>

{#if data.voiceLearned}
	<section class={section} id="voz-aprendido">
		<h2 class="mb-1 font-semibold">Lo que ha aprendido la voz</h2>
		<p class="mb-3 text-sm text-zinc-400">
			Cuando la voz duda y te pregunta («¿un temporizador de media hora, o parar la música?»), se
			acuerda de lo que contestas, en ese sitio, y la próxima vez lo hace sin preguntar. Si aprendió
			algo mal, quítalo con ×.
		</p>
		{#if byPlace.length}
			<div class="flex flex-col gap-3 text-sm">
				{#each byPlace as [place, learned] (place)}
					<div>
						<h3 class="mb-1 text-xs tracking-wide text-zinc-500 uppercase">{place}</h3>
						<ul class="flex flex-col gap-1">
							{#each learned ?? [] as l (l.id)}
								<li class="flex items-start gap-2">
									<div class="min-w-0 flex-1">
										<p class="text-zinc-200">{l.title}</p>
										<p class="text-xs text-zinc-500">{l.rule}</p>
									</div>
									<form method="post" action="?seccion={tab}&/forgetVoiceLearned" use:enhance>
										<input type="hidden" name="id" value={l.id} />
										<button
											class="rounded px-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
											aria-label="Olvidar «{l.title}»">×</button
										>
									</form>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{:else}
			<span class="text-xs text-zinc-500">Aún nada: lo irá aprendiendo de sus preguntas.</span>
		{/if}
	</section>
{/if}
