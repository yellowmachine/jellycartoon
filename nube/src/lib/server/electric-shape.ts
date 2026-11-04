import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';

/**
 * Piloto de Electric (#394): lo que baja a las casas, y cómo. Como `withFamily`, pero aquí no lo
 * hace cumplir Postgres: Electric lee con un solo rol para todas las familias, y sin filtro da las
 * de todas. Este es el único sitio que escribe ese filtro. Tabla, columnas y `where` son fijos, y la
 * familia va como parámetro: de la petición solo pasan los datos del protocolo.
 */
export const SHAPES = {
	tag: { columns: 'id,name' },
	// `family_id`, porque es parte de su clave y Electric la exige; la casa lo descarta.
	series_tag: { columns: 'family_id,series_id,tag_id' }
} as const;

export type ShapeName = keyof typeof SHAPES;

export const isShape = (name: string): name is ShapeName => Object.hasOwn(SHAPES, name);

/** Del protocolo, salvo las consultas parciales: las casas bajan la tabla entera. */
const PROTOCOL = ELECTRIC_PROTOCOL_QUERY_PARAMS.filter((p) => !p.startsWith('subset__'));

/** La dirección del shape de una familia en Electric. Sin familia, ninguna. */
export function shapeUrl(
	electric: { url: string; secret: string },
	familyId: string,
	name: ShapeName,
	query: URLSearchParams
) {
	if (!familyId) throw new Error('Sin familia');
	const shape = new URL('/v1/shape', electric.url);
	for (const param of PROTOCOL) {
		const value = query.get(param);
		if (value !== null) shape.searchParams.set(param, value);
	}
	shape.searchParams.set('table', name);
	shape.searchParams.set('columns', SHAPES[name].columns);
	shape.searchParams.set('where', 'family_id = $1');
	shape.searchParams.set('params[1]', familyId);
	shape.searchParams.set('secret', electric.secret);
	return shape;
}
