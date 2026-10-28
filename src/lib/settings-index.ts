import { fold } from 'comun/music.ts';

/**
 * What is in Ajustes, to find it by a word from the box above its tabs: each section, its tab, and
 * words one might look for it by, also those it does not say («wifi», «IA», «niños»). The page only
 * draws the open tab, so the search cannot look at it: it looks here. Shown only where the page
 * shows the section (`shown`, from the page's data). A test checks every `id` is on the page.
 */

export type SettingsTab = 'mi' | 'aparato' | 'casa' | 'cuenta';

/** What decides which sections the page shows, as its data has it. */
export interface SettingsShown {
	kid: boolean;
	intro: boolean | null;
	keepHistory: boolean | null;
	recordTrips: boolean | null;
	langua: unknown;
	telegram: unknown;
	musicApps: unknown;
	voice: boolean;
	music: boolean;
	ai: unknown;
	spendLine: boolean | null;
	labels: unknown;
	routes: unknown;
	relay: unknown;
	satellites: unknown;
	cloudKeys: unknown;
	home: unknown;
	houseVoice: unknown;
	kids: unknown;
	twoFactor: unknown;
}

export interface SettingsEntry {
	/** The section's `id` on the page: `?seccion=<tab>#<id>`. */
	id: string;
	tab: SettingsTab;
	title: string;
	words: string;
	shown?: (d: SettingsShown) => boolean;
}

export const TAB_LABELS: Record<SettingsTab, string> = {
	mi: 'Para mí',
	aparato: 'Este aparato',
	casa: 'Casa',
	cuenta: 'Cuenta'
};

/**
 * The tabs before #178, in links that are still around: where most of each went. With a section in
 * the link (`#microfono`), the index says its tab.
 */
export const OLD_TABS: Record<string, SettingsTab> = {
	ver: 'mi',
	conexiones: 'mi',
	aspecto: 'aparato'
};

export const SETTINGS_INDEX: SettingsEntry[] = [
	{
		id: 'reproduccion',
		tab: 'mi',
		title: 'Reproducción',
		words: 'idioma audio subtítulos doblaje versión original inglés español'
	},
	{
		id: 'estilo-subtitulos',
		tab: 'mi',
		title: 'Estilo de los subtítulos',
		words: 'subtítulos letra tamaño fondo dos líneas rodando whisper'
	},
	{
		id: 'cortinilla',
		tab: 'mi',
		title: 'Cortinilla de Cine Club',
		words: 'intro películas salón cine club entrada mpv',
		shown: (d) => d.intro !== null
	},
	{
		id: 'sigues-ahi',
		tab: 'mi',
		title: '¿Sigues ahí?',
		words: 'dormir dormirse siguiente automático capítulos seguidos parar pregunta',
		shown: (d) => !d.kid
	},
	{
		id: 'lo-que-veo',
		tab: 'mi',
		title: 'Lo que se guarda de ti',
		words: 'historial guardar estadísticas privacidad horas',
		shown: (d) => d.keepHistory !== null
	},
	{
		id: 'guardar-viajes',
		tab: 'mi',
		title: 'Guardar mis viajes',
		words: 'viajes modo carretera recorridos gps km coche',
		shown: (d) => d.recordTrips !== null
	},
	{
		id: 'telegram',
		tab: 'mi',
		title: 'Telegram',
		words: 'telegram mensajes coche carretera leer voz conducir chat',
		shown: (d) => Boolean(d.telegram)
	},
	{
		id: 'langua',
		tab: 'mi',
		title: 'Langua',
		words: 'idiomas clips aprender inglés token app',
		shown: (d) => Boolean(d.langua)
	},
	{
		id: 'musica-en-apps',
		tab: 'mi',
		title: 'Música en apps',
		words: 'subsonic tempus contraseña app móvil música servidor',
		shown: (d) => Boolean(d.musicApps)
	},
	{
		id: 'colores',
		tab: 'mi',
		title: 'Colores',
		words: 'tema modo oscuro claro noche color apariencia'
	},
	{
		id: 'al-abrir',
		tab: 'mi',
		title: 'Al abrir la app',
		words: 'frase rótulo frasier inicio arranque cita'
	},
	{
		id: 'este-dispositivo',
		tab: 'aparato',
		title: 'Nombre y avisos',
		words:
			'nombre dispositivo aparato móvil tablet tele salón navegador sonaba avisos notificaciones push nevera lista compra'
	},
	{
		id: 'microfono',
		tab: 'aparato',
		title: 'Voz y micrófono',
		words: 'voz hablar pulsar mantener tocar asistente silencio callarte enviar solo',
		shown: (d) => d.voice
	},
	{
		id: 'hola-casita',
		tab: 'aparato',
		title: '«Hola casita»',
		words:
			'palabra de activación manos libres sin pulsar escuchar probar umbral sensibilidad tele limpiar ruido eco avanzado nivel barras',
		shown: (d) => d.voice
	},
	{
		id: 'calidad-musica',
		tab: 'aparato',
		title: 'Calidad de la música',
		words: 'datos móviles ahorrar opus flac calidad sonido',
		shown: (d) => d.music
	},
	{
		id: 'modo-dj',
		tab: 'mi',
		title: 'Modo DJ',
		words: 'locutor dj radio voz mezclada entre canciones música',
		shown: (d) => d.music
	},
	{
		id: 'fondo-musica',
		tab: 'aparato',
		title: 'Fondo de Música',
		words: 'fondo imagen música portada',
		shown: (d) => d.music
	},
	{
		id: 'ia',
		tab: 'casa',
		title: 'Inteligencia artificial',
		words: 'ia openrouter clave modelo películas voz conversar ollama visión',
		shown: (d) => Boolean(d.ai)
	},
	{
		id: 'credito',
		tab: 'casa',
		title: 'Crédito y gasto',
		words: 'dinero saldo gasto coste openrouter pagar euros dólares',
		shown: (d) => Boolean(d.ai)
	},
	{
		id: 'gasto-ia',
		tab: 'mi',
		title: 'Gasto del mes',
		words: 'ia gasto dinero coste openrouter crédito línea cabecera dólares',
		shown: (d) => d.spendLine !== null
	},
	{
		id: 'modelos',
		tab: 'casa',
		title: 'Modelos',
		words: 'modelo ia películas escenas voz deberes conversar visión',
		shown: (d) => Boolean(d.ai)
	},
	{
		id: 'etiquetas',
		tab: 'casa',
		title: 'Etiquetas de los capítulos',
		words: 'etiquetas escenas capítulos ollama visión conjuntos',
		shown: (d) => Boolean(d.labels)
	},
	{
		id: 'rutas',
		tab: 'casa',
		title: 'Rutas del modo carretera',
		words: 'openrouteservice ors mapa navegador navegación clave coche',
		shown: (d) => Boolean(d.routes)
	},
	{
		id: 'compartir-viajes',
		tab: 'casa',
		title: 'Compartir viajes',
		words: 'relé enlace directo dónde voy compartir viaje whatsapp',
		shown: (d) => Boolean(d.relay)
	},
	{
		id: 'donde-casa',
		tab: 'casa',
		title: 'Dónde está la casa',
		words: 'tiempo previsión lluvia temperatura pueblo ciudad ubicación localización open-meteo',
		shown: (d) => Boolean(d.home)
	},
	{
		id: 'voz-casa',
		tab: 'casa',
		title: 'Voz de la casa',
		words:
			'voz piper satélite hombre mujer masculina femenina hablar respuesta frases espera vale momento tarda volumen alto fuerte música bajar',
		shown: (d) => Boolean(d.houseVoice)
	},
	{
		id: 'satelites',
		tab: 'casa',
		title: 'Satélites de voz',
		words:
			'satélite raspberry micrófono hola casita clave salón alexa altavoz snapcast bajar música',
		shown: (d) => Boolean(d.satellites)
	},
	{
		id: 'nube',
		tab: 'casa',
		title: 'La nube',
		words: 'nube clave api vídeo series fuera de casa túnel rathole nevera recetas lista compra',
		shown: (d) => Boolean(d.cloudKeys)
	},
	{
		id: 'personas',
		tab: 'casa',
		title: 'Personas de la casa',
		words:
			'cuentas usuarios adultos añadir invitar enlace qr contraseña olvidada dibujo avatar niños peques infantil hijos permiso tiempo pantalla horario',
		shown: (d) => Boolean(d.kids)
	},
	{
		id: 'cuentas-infantiles',
		tab: 'casa',
		title: 'Peques',
		words: 'niños peques infantil hijos cuenta permiso tiempo pantalla horario',
		shown: (d) => Boolean(d.kids)
	},
	{
		id: 'dispositivos-casa',
		tab: 'casa',
		title: 'Dispositivos de la casa',
		words: 'dispositivos confianza tablet niños entrar sin contraseña',
		shown: (d) => Boolean(d.kids)
	},
	{
		id: 'version',
		tab: 'casa',
		title: 'Versión',
		words: 'actualizar actualización novedades wud versión nueva'
	},
	{
		id: 'cuenta',
		tab: 'cuenta',
		title: 'Cuenta',
		words: 'salir cerrar sesión correo email usuario dibujo avatar'
	},
	{
		id: 'dos-pasos',
		tab: 'cuenta',
		title: 'Verificación en dos pasos',
		words: '2fa seguridad códigos autenticador contraseña',
		shown: (d) => Boolean(d.twoFactor)
	}
];

/** Its words, accents and case aside. */
const wordsOf = (text: string) =>
	fold(text)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);

/** Every word typed starts one of `text`'s: «ia» is not in «viajes», «subt» is in «subtítulos». */
const has = (text: string[], typed: string[]) =>
	typed.every((w) => text.some((t) => t.startsWith(w)));

/**
 * The sections with every word typed, in their title, their words or their tab, accents and case
 * aside; those whose title has them first.
 */
export function searchSettings(query: string, shown: SettingsShown, max = 8): SettingsEntry[] {
	const typed = wordsOf(query);
	if (!typed.length) return [];
	const found = SETTINGS_INDEX.filter((e) => e.shown?.(shown) ?? true).filter((e) =>
		has(wordsOf(`${e.title} ${e.words} ${TAB_LABELS[e.tab]}`), typed)
	);
	const inTitle = (e: SettingsEntry) => has(wordsOf(e.title), typed);
	return [...found.filter(inTitle), ...found.filter((e) => !inTitle(e))].slice(0, max);
}
