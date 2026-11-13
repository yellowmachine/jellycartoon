import { searchSettings as search, type SettingsEntry } from 'comun/settings-search.ts';

/**
 * What is in the cloud's Ajustes (#253), to find it by a word from the box above its tabs, as at
 * home (jellycartoon's settings-index.ts): each section, its tab, and words one might look for it
 * by. A test checks every `id` is on the page.
 */

export type SettingsTab = 'mi' | 'aparato' | 'familia' | 'conexiones' | 'cuenta';

export const TAB_LABELS: Record<SettingsTab, string> = {
	mi: 'Para mí',
	aparato: 'Este aparato',
	familia: 'Familia',
	conexiones: 'Conexiones',
	cuenta: 'Cuenta'
};

/** What decides which sections the page shows, as its data has it. */
export interface SettingsShown {
	/** Who manages the family: its house, its keys, its voice, its bot. */
	admin: boolean;
	/** The AI's spending line: with the family's OpenRouter key. */
	spendLine?: boolean;
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
		id: 'reglas-y-memoria',
		tab: 'mi',
		title: 'Reglas y memoria (en su página)',
		words:
			'reglas cuando si entonces avisar automático condiciones qué pasaría memoria recordar recuerda olvidar apuntar llave talla datos voz costumbres hábitos aprendido'
	},
	{
		id: 'noticias',
		tab: 'mi',
		title: 'Noticias',
		words: 'miniflux rss feeds agregador titulares periódico inicio clave api'
	},
	{
		id: 'como-te-aviso',
		tab: 'mi',
		title: 'Cómo te aviso',
		words: 'buzón recados mensajes correo email'
	},
	{
		id: 'subtitulos',
		tab: 'mi',
		title: 'Subtítulos',
		words: 'subtítulos letra tamaño color fondo canales tele estilo'
	},
	{
		id: 'mi-barra',
		tab: 'mi',
		title: 'Mi barra',
		words:
			'mi barra secciones menú ocultar quitar mostrar ver arriba series música radio canales recetas nevera agenda llamadas dinero gastos papeles viajes paseos preguntar reglas notas enchufes deberes juegos estadísticas oración'
	},
	{
		id: 'viajes',
		tab: 'mi',
		title: 'Tus viajes',
		words: 'guardar mis viajes recorrido kilómetros km gps carretera privacidad historial'
	},
	{
		id: 'gasto-ia',
		tab: 'mi',
		title: 'Línea de gasto',
		words: 'ia gasto mes semana dinero coste openrouter crédito línea cabecera dólares',
		shown: (d) => Boolean(d.spendLine)
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
		id: 'telefono',
		tab: 'aparato',
		title: 'Llamar por teléfono',
		words: 'teléfono sim llamar llamada contactos agenda móvil tablet coche número'
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
		id: 'espacio',
		tab: 'familia',
		title: 'Espacio',
		words: 'espacio almacenamiento lleno cuota fotos ficheros gigas megas sitio ocupa'
	},
	{
		id: 'donde-vivis',
		tab: 'familia',
		title: 'Dónde vivís',
		words: 'tiempo pueblo ciudad sitio casa ubicación portada clima',
		shown: onlyAdmin
	},
	{
		id: 'coches',
		tab: 'familia',
		title: 'Coches',
		words: 'coche coches dónde está aparcado aparcar parking mi coche el tuyo furgo'
	},
	{
		id: 'avisos-paginas',
		tab: 'familia',
		title: 'Avisos en las páginas',
		words:
			'avisos amarillo repetido duplicado ticket factura dos veces descuido no me lo vuelvas a decir gastos'
	},
	{
		id: 'casa',
		tab: 'conexiones',
		title: 'Tu casa',
		words: 'jellycartoon dirección túnel rathole conectar series música media'
	},
	{
		id: 'clave-casa',
		tab: 'conexiones',
		title: 'Clave para la casa',
		words: 'api key nube_ voz tele conectar casa'
	},
	{
		id: 'ia',
		tab: 'conexiones',
		title: 'IA (OpenRouter)',
		words: 'inteligencia artificial openrouter clave recetas tickets facturas saldo'
	},
	{
		id: 'rutas',
		tab: 'conexiones',
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
		id: 'secciones',
		tab: 'familia',
		title: 'Secciones de la familia',
		words:
			'secciones módulos barra menú ocultar quitar mostrar encender apagar juegos consolas deberes series música radio canales recetas nevera agenda dinero gastos papeles viajes oración rezar rezo religión rosario letanías plegarias misa vaticano',
		shown: onlyAdmin
	},
	{
		id: 'voz-aprende',
		tab: 'familia',
		title: 'Aprender de lo que se habla',
		words: 'aprender aprendizaje memoria conversación hablar voz recordar sola',
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
		id: 'satelites',
		tab: 'familia',
		title: 'Satélites de voz',
		words: 'satélite raspberry altavoz micrófono habitación dormitorio alexa clave voz',
		shown: onlyAdmin
	},
	{
		id: 'voz-satelites',
		tab: 'familia',
		title: 'Voz de los satélites',
		words: 'voz satélite gemini kore acento tono frases espera vale momento hablar sonar',
		shown: onlyAdmin
	},
	{
		id: 'compania',
		tab: 'familia',
		title: 'Compañía',
		words:
			'compañía mayores solo sola abuela abuelo preguntar cómo estás avisar familia vinculada satélite cuidar',
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
		id: 'entrar-con-la-nube',
		tab: 'conexiones',
		title: 'Entrar en casa con Seilide',
		words: 'oidc openid cuenta única login entrar casa jellycartoon cliente secreto env',
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
		id: 'familias-vinculadas',
		tab: 'familia',
		title: 'Familias vinculadas',
		words: 'vincular unir otra familia padres abuelos hermana llamar llamadas contactos qr enlace'
	},
	{
		id: 'administracion',
		tab: 'familia',
		title: 'Administración',
		words: 'administrador administrar pasar rol ceder familia cambiar quien manda',
		shown: onlyAdmin
	},
	{
		id: 'telegram-bot',
		tab: 'conexiones',
		title: 'Bot de Telegram',
		words: 'telegram grupo avisos bot botfather mensajes',
		shown: onlyAdmin
	},
	{
		id: 'salir-familia',
		tab: 'cuenta',
		title: 'Salir de la familia',
		words: 'salir irme dejar familia separarme separacion desvincular cambiar otra'
	},
	{
		id: 'eliminar-cuenta',
		tab: 'cuenta',
		title: 'Eliminar mi cuenta',
		words: 'borrar eliminar cuenta baja darme de baja irme quitar definitivamente rgpd'
	},
	{
		id: 'mis-datos',
		tab: 'cuenta',
		title: 'Tus datos',
		words: 'descargar datos zip exportar copia portabilidad rgpd mis llevarme'
	},
	{
		id: 'contrasena',
		tab: 'cuenta',
		title: 'Contraseña',
		words: 'cambiar clave olvidada seguridad'
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
