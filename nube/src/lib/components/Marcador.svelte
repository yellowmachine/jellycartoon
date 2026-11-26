<script lang="ts">
	import { page } from '$app/state';
	import { bookmarklet } from '#lib/wishes.ts';
	import { section } from '#lib/styles.ts';

	/**
	 * «📥 A Seilide» (#586, #633): the computer's bookmark, for any page. A shop's product to the
	 * wishes, a recipe, a podcast, a note to read later, or sent to someone: «¿Qué hago con este
	 * enlace?» asks, the likeliest first. On a phone, sharing the link with Seilide does the same.
	 */
</script>

<section class={section} id="marcador">
	<h2 class="mb-1 font-semibold">Marcador del ordenador</h2>
	<p class="text-sm text-zinc-400 sm:hidden">
		En el móvil no hace falta: comparte el enlace con Seilide desde cualquier app.
	</p>
	<div class="hidden sm:block">
		<p class="mb-3 text-sm text-zinc-400">
			Arrastra este botón a la barra de marcadores. En cualquier web, púlsalo y Seilide te pregunta
			qué hacer con ella: un producto, a la lista de deseos (con su nombre, foto, precio y envío,
			también en Amazon); una receta, a Recetas; un podcast, suscribirte; cualquier otra, guardarla
			en Notas para leerla luego, o mandársela a alguien.
		</p>
		<!-- Its text is the bookmark's name: a bookmark of code has no icon of its own, so the emoji
		is what tells it apart in the bar. -->
		<a
			href={bookmarklet(page.url.origin)}
			class="inline-flex items-center rounded-md border border-amber-500/60 px-3 py-1.5 text-sm font-medium text-amber-300"
			onclick={(e) => e.preventDefault()}
			title="Arrástralo a la barra de marcadores">📥 A Seilide</a
		>
		<p class="mt-2 text-xs text-zinc-500">
			¿Tenías el de «🎁 Deseos»? Sigue funcionando, pero bórralo y arrastra este: además sabe si la
			página es una receta o un podcast.
		</p>
		<!-- What any bookmark of code may do, this one or another site's: said before it is dragged. -->
		<div
			class="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-zinc-300"
			role="note"
		>
			<p class="mb-2 font-semibold text-amber-300">
				Antes de arrastrar un marcador, este o el de cualquier web
			</p>
			<ul class="list-disc space-y-1 pl-5">
				<li>
					Un marcador así es código: al pulsarlo se ejecuta dentro de la página que tienes abierta,
					con tu sesión iniciada en ella.
				</li>
				<li>
					Puede leer y cambiar todo lo que ves en esa página, también lo que escribes, y hacer cosas
					en esa web como si fueras tú: en una tienda, ver tus pedidos; en tu banco, lo que veas
					allí.
				</li>
				<li>
					No llega a otras pestañas, ni a tus contraseñas guardadas, ni a tus ficheros, y solo hace
					algo cuando lo pulsas.
				</li>
				<li>
					Arrastra solo marcadores de quien te fíes, y no pegues nunca en el navegador código que te
					pidan en un mensaje o en una web.
				</li>
				<li>
					Este lee el nombre, la foto, el precio, el envío y la dirección de la página, si tiene una
					receta y el feed de su podcast, y abre Seilide con ellos. También recoge el texto visible
					del producto y las opciones elegidas (nunca lo que escribes), que no salen de tu ordenador
					si no pulsas «Analizar con IA». Su código se puede ver con el botón derecho sobre el
					marcador → Editar.
				</li>
			</ul>
		</div>
	</div>
</section>
