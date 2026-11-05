/**
 * The shaders of EmulatorJS 4.2.3 (its data/src/shaders.js), for the whole house (#176): for all
 * the games, a console's or one game's, the nearest one winning.
 */
export const SHADERS = [
	{ id: 'disabled', name: 'Sin shader', description: 'Los píxeles tal cual' },
	{ id: 'crt-easymode.glslp', name: 'CRT easymode', description: 'Tele de tubo, ligero' },
	{ id: 'crt-geom.glslp', name: 'CRT geom', description: 'Tele de tubo, con su curva' },
	{ id: 'crt-aperture.glslp', name: 'CRT aperture', description: 'Tele de tubo, con rejilla' },
	{ id: 'crt-mattias.glslp', name: 'CRT mattias', description: 'Tele de tubo, con brillo' },
	{ id: 'crt-lottes', name: 'CRT lottes', description: 'Monitor de arcade' },
	{ id: 'crt-beam', name: 'CRT beam', description: 'Tele de tubo, líneas marcadas' },
	{ id: 'crt-caligari', name: 'CRT caligari', description: 'Tele de tubo, puntos de fósforo' },
	{ id: 'crt-yeetron', name: 'CRT yeetron', description: 'Tele de tubo, sencillo' },
	{ id: 'crt-zfast', name: 'CRT zfast', description: 'Tele de tubo, el más rápido' },
	{ id: '2xScaleHQ.glslp', name: '2xScaleHQ', description: 'Bordes suavizados' },
	{ id: '4xScaleHQ.glslp', name: '4xScaleHQ', description: 'Bordes más suavizados' },
	{ id: 'sabr', name: 'SABR', description: 'Píxeles redondeados' },
	{ id: 'bicubic', name: 'Bicúbico', description: 'Imagen suavizada' },
	{
		id: 'mix-frames',
		name: 'Mezclar fotogramas',
		description: 'Sin parpadeos, como en la Game Boy'
	}
] as const;

export type Shader = (typeof SHADERS)[number]['id'];

export const isShader = (value: unknown): value is Shader => SHADERS.some((s) => s.id === value);

export const shaderName = (id: Shader) => SHADERS.find((s) => s.id === id)!.name;

/** Where one is set: for all, a console (by its folder) or a game (by its row). */
export const ALL = 'todos';
export const systemScope = (system: string) => `consola:${system}`;
export const gameScope = (gameId: number) => `juego:${gameId}`;
