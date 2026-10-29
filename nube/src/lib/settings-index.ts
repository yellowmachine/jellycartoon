import { searchSettings as search, type SettingsEntry } from 'comun/settings-search.ts';

/**
 * What is in the cloud's Ajustes (#253), to find it by a word from the box above its tabs, as at
 * home (jellycartoon's settings-index.ts): each section, its tab, and words one might look for it
 * by. A test checks every `id` is on the page.
 */

export type SettingsTab = 'mi' | 'aparato' | 'familia' | 'cuenta';

export const TAB_LABELS: Record<SettingsTab, string> = {
	mi: 'Para mí',
	aparato: 'Este aparato',
	familia: 'Familia',
	cuenta: 'Cuenta'
};

/** What decides which sections the page shows, as its data has it. */
export interface SettingsShown {
	/** Who manages the family: its house, its keys, its voice, its bot. */
	admin: boolean;
}

const onlyAdmin = (d: SettingsShown) => d.admin;

export const SETTINGS_INDEX: SettingsEntry<SettingsTab, SettingsShown>[] = [
	{
		id: 'colores',
		tab: 'mi',
		title: 'Colores',
		words: 'tema paleta modo oscuro aspecto gruvbox nord dracula catppuccin'
	},
	{
		id: 'caracter-mio',
		tab: 'mi',
		title: 'Cómo quieres que te hable la voz',
		words: 'voz carácter personalidad tono humor tomar el pelo chistes asistente estilo'
	},
	{
		id: 'subtitulos',
		tab: 'mi',
		title: 'Subtítulos',
		words: 'subtítulos letra tamaño color fondo canales tele estilo'
	},
	{
		id: 'viajes',
		tab: 'mi',
		title: 'Tus viajes',
		words: 'guardar mis viajes recorrido kilómetros km gps carretera privacidad historial'
	},
	{
		id: 'avisos',
		tab: 'aparato',
		title: 'Avisos en este dispositivo',
		words: 'notificaciones push alarmas agenda móvil avisar'
	},
	{
		id: 'microfono',
		tab: 'aparato',
		title: 'Voz y micrófono',
		words: 'micrófono hablar voz mantener pulsado tocar toques atajo teclado'
	},
	{
		id: 'fondo-musica',
		tab: 'aparato',
		title: 'Fondo de Música',
		words: 'fondo música colores portada animación aurora movimiento'
	},
	{
		id: 'personas',
		tab: 'familia',
		title: 'Personas',
		words: 'familia peques niños hijos dibujo avatar sin cuenta agenda'
	},
	{
		id: 'casa',
		tab: 'familia',
		title: 'Tu casa',
		words: 'jellycartoon dirección túnel rathole conectar series música media'
	},
	{
		id: 'clave-casa',
		tab: 'familia',
		title: 'Clave para la casa',
		words: 'api key nube_ voz tele conectar casa'
	},
	{
		id: 'ia',
		tab: 'familia',
		title: 'IA (OpenRouter)',
		words: 'inteligencia artificial openrouter clave recetas tickets facturas saldo'
	},
	{
		id: 'rutas',
		tab: 'familia',
		title: 'Rutas (openrouteservice)',
		words: 'mapa carretera navegación coche ors clave'
	},
	{
		id: 'voz',
		tab: 'familia',
		title: 'La voz',
		words: 'modelo alexa asistente ia openrouter satélites',
		shown: onlyAdmin
	},
	{
		id: 'caracter-casa',
		tab: 'familia',
		title: 'Cómo es la voz de la casa',
		words: 'voz carácter personalidad tono humor tomar el pelo chistes asistente estilo',
		shown: onlyAdmin
	},
	{
		id: 'voz-internet',
		tab: 'familia',
		title: 'Buscar en internet desde la voz',
		words: 'internet web buscar google noticias resultados deportes fútbol actualidad',
		shown: onlyAdmin
	},
	{
		id: 'voz-silencio',
		tab: 'familia',
		title: 'Horas de silencio',
		words: 'noche madrugada dormir silencio no molestar música voz confirmar preguntar',
		shown: onlyAdmin
	},
	{
		id: 'invitaciones',
		tab: 'familia',
		title: 'Invitaciones',
		words: 'invitar familia cuenta email correo enlace miembros entrar alta',
		shown: onlyAdmin
	},
	{
		id: 'telegram-bot',
		tab: 'familia',
		title: 'Bot de Telegram',
		words: 'telegram grupo avisos bot botfather mensajes',
		shown: onlyAdmin
	},
	{
		id: 'dos-pasos',
		tab: 'cuenta',
		title: 'Verificación en dos pasos',
		words: '2fa seguridad códigos autenticador contraseña'
	}
];

/** The sections with every word typed (comun/settings-search.ts). */
export const searchSettings = (query: string, shown: SettingsShown, max = 8) =>
	search(SETTINGS_INDEX, TAB_LABELS, query, shown, max);
