import { fold } from './music.ts';

/**
 * What is in Ajustes, to find it by a word from the box above its tabs: each section, its tab, and
 * words one might look for it by, also those it does not say («wifi», «IA», «niños»). The page only
 * draws the open tab, so the search cannot look at it: it looks here. Shown only where the page
 * shows the section (`shown`, from the page's data). A test checks every `id` is on the page.
 */

export type SettingsTab = 'ver' | 'aspecto' | 'conexiones' | 'casa' | 'cuenta';

/** What decides which sections the page shows, as its data has it. */
export interface SettingsShown {
	kid: boolean;
	intro: boolean | null;
	keepHistory: boolean | null;
	recordTrips: boolean | null;
	langua: unknown;
	musicApps: unknown;
	voice: boolean;
	music: boolean;
	ai: unknown;
	labels: unknown;
	routes: unknown;
	relay: unknown;
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
	ver: 'Ver',
	aspecto: 'Aspecto',
	conexiones: 'Conexiones',
	casa: 'Casa',
	cuenta: 'Cuenta'
};

export const SETTINGS_INDEX: SettingsEntry[] = [
	{
		id: 'reproduccion',
		tab: 'ver',
		title: 'Reproducción',
		words: 'idioma audio subtítulos doblaje versión original inglés español'
	},
	{
		id: 'estilo-subtitulos',
		tab: 'ver',
		title: 'Estilo de los subtítulos',
		words: 'subtítulos letra tamaño fondo dos líneas rodando whisper'
	},
	{
		id: 'cortinilla',
		tab: 'ver',
		title: 'Cortinilla de Cine Club',
		words: 'intro películas salón cine club entrada mpv',
		shown: (d) => d.intro !== null
	},
	{
		id: 'lo-que-veo',
		tab: 'ver',
		title: 'Lo que veo',
		words: 'historial guardar estadísticas privacidad horas',
		shown: (d) => d.keepHistory !== null
	},
	{
		id: 'guardar-viajes',
		tab: 'ver',
		title: 'Guardar mis viajes',
		words: 'viajes modo carretera recorridos gps km coche',
		shown: (d) => d.recordTrips !== null
	},
	{
		id: 'langua',
		tab: 'conexiones',
		title: 'Langua',
		words: 'idiomas clips aprender inglés token app',
		shown: (d) => Boolean(d.langua)
	},
	{
		id: 'musica-en-apps',
		tab: 'conexiones',
		title: 'Música en apps',
		words: 'subsonic tempus contraseña app móvil música servidor',
		shown: (d) => Boolean(d.musicApps)
	},
	{
		id: 'colores',
		tab: 'aspecto',
		title: 'Colores',
		words: 'tema modo oscuro claro noche color apariencia'
	},
	{
		id: 'al-abrir',
		tab: 'aspecto',
		title: 'Al abrir la app',
		words: 'frase rótulo frasier inicio arranque cita'
	},
	{
		id: 'este-dispositivo',
		tab: 'aspecto',
		title: 'Este dispositivo',
		words:
			'nombre dispositivo móvil tablet tele salón navegador sonaba palabra de activación avisos notificaciones push nevera lista compra'
	},
	{
		id: 'microfono',
		tab: 'aspecto',
		title: 'Micrófono',
		words: 'voz hablar pulsar mantener tocar asistente',
		shown: (d) => d.voice
	},
	{
		id: 'calidad-musica',
		tab: 'aspecto',
		title: 'Calidad de la música',
		words: 'datos móviles ahorrar opus flac calidad sonido',
		shown: (d) => d.music
	},
	{
		id: 'fondo-musica',
		tab: 'aspecto',
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
		id: 'cuentas-infantiles',
		tab: 'casa',
		title: 'Cuentas infantiles',
		words: 'niños peques infantil hijos permiso tiempo pantalla horario',
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
		words: 'salir cerrar sesión correo email usuario'
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
