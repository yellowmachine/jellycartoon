/**
 * The screenshots' example family (#495): invented, never anyone's. Written as the database's
 * owner (row security does not apply to it), into the family of the account capturas.ts signed
 * up. The days, around today: the pages always show «this month» full.
 *
 *   bun scripts/capturas/datos.ts <owner database URL> <email>
 */
import postgres from 'postgres';

const [url, email] = process.argv.slice(2);
if (!url || !email) throw new Error('Uso: datos.ts <MIGRATE_DATABASE_URL> <email>');
const sql = postgres(url, { max: 1, onnotice: () => {} });

/** A day `n` days from today, as Postgres' date. */
const day = (n: number) => {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return d.toISOString().slice(0, 10);
};
/** This month's day `n`, but not after today (a receipt is never from the future). */
const thisMonth = (n: number) => {
	const d = new Date();
	const today = d.getDate();
	d.setDate(Math.min(n, today));
	return d.toISOString().slice(0, 10);
};
/** The same day, `back` months ago. */
const monthsAgo = (back: number, n: number) => {
	const d = new Date();
	d.setDate(1);
	d.setMonth(d.getMonth() - back);
	d.setDate(n);
	return d.toISOString().slice(0, 10);
};

try {
	const [me] = await sql`
		select u.id, m.family_id from "user" u join family_member m on m.user_id = u.id
		where u.email = ${email}`;
	if (!me) throw new Error(`No hay cuenta para ${email}`);
	const family = me.family_id as string;
	const userId = me.id as string;

	// Gastos: tickets with their lines, bills and fixed ones, this month and the two before.
	type Line = [text: string, amount: number, tag: string];
	const expense = async (
		date: string,
		store: string,
		category: string,
		source: string,
		lines: Line[],
		total?: number
	) => {
		const sum = total ?? lines.reduce((s, [, a]) => s + a, 0);
		const [row] = await sql`
			insert into expense (family_id, date, store, category, total, source, user_id)
			values (${family}, ${date}, ${store}, ${category}, ${sum}, ${source}, ${userId})
			returning id`;
		for (const [i, [text, amount, tag]] of lines.entries())
			await sql`
				insert into expense_line (family_id, expense_id, position, text, amount, tag)
				values (${family}, ${row!.id}, ${i}, ${text}, ${amount}, ${tag})`;
	};
	const shop: Line[] = [
		['Tomate pera', 289, 'Fruta y verdura'],
		['Plátano de Canarias', 245, 'Fruta y verdura'],
		['Pechuga de pollo', 612, 'Carne y pescado'],
		['Leche semidesnatada 6 l', 534, 'Lácteos y huevos'],
		['Huevos L docena', 289, 'Lácteos y huevos'],
		['Pan de pueblo', 180, 'Panadería'],
		['Arroz redondo', 165, 'Despensa'],
		['Aceite de oliva 1 l', 895, 'Despensa'],
		['Galletas', 219, 'Caprichos'],
		['Detergente', 675, 'Limpieza']
	];
	for (const [back, scale] of [
		[0, 1],
		[1, 1.08],
		[2, 0.95]
	] as const) {
		const at = (n: number) => (back === 0 ? thisMonth(n) : monthsAgo(back, n));
		const lines = shop.map(([t, a, tag]): Line => [t, Math.round(a * scale), tag]);
		await expense(at(3), 'Supermercado El Sol', 'Supermercado', 'ticket', lines);
		await expense(at(10), 'Supermercado El Sol', 'Supermercado', 'ticket', lines.slice(0, 7));
		await expense(at(1), 'Frutería Lola', 'Supermercado', 'ticket', [
			['Naranjas 3 kg', 450, 'Fruta y verdura'],
			['Fresas', 299, 'Fruta y verdura'],
			['Patatas 5 kg', 399, 'Fruta y verdura']
		]);
		await expense(at(6), 'Gasolinera Ruta 3', 'Gasolina', 'ticket', [
			['Gasolina 95', Math.round(5840 * scale), 'Otros']
		]);
		await expense(at(8), 'Pizzería La Plaza', 'Restaurantes', 'ticket', [
			['Pizzas y bebidas', Math.round(4260 * scale), 'Otros']
		]);
		await expense(at(2), 'Farmacia Plaza', 'Farmacia y salud', 'ticket', [
			['Jarabe para la tos', 785, 'Medicamentos'],
			['Crema solar', 1290, 'Higiene']
		]);
		await expense(at(5), 'Compañía de la luz', 'Facturas', 'factura', [], Math.round(6780 * scale));
		await expense(at(13), 'Supermercado El Sol', 'Supermercado', 'ticket', lines.slice(2, 9));
		await expense(at(1), 'Comunidad de vecinos', 'Casa', 'fijo', [], 6500);
		await expense(at(4), 'Seguro del coche', 'Seguros', 'fijo', [], 3850);
		await expense(at(9), 'Material del cole', 'Niños', 'mano', [], Math.round(2340 * scale));
		await expense(at(7), 'Películas en casa', 'Suscripciones', 'fijo', [], 1299);
	}

	// Agenda: who is in the family, and their week.
	const people: Record<string, number> = {};
	for (const [name, avatar] of [
		['Lucía', 'conejo'],
		['Pablo', 'leon'],
		['Abuela Carmen', 'tortuga']
	]) {
		const [row] = await sql`
			insert into family_person (family_id, name, avatar) values (${family}, ${name}, ${avatar})
			returning id`;
		people[name!] = row!.id;
	}
	const event = async (
		title: string,
		startDay: string,
		startTime: string | null,
		who: string[],
		repeat: string | null = null,
		notes: string | null = null
	) => {
		const [row] = await sql`
			insert into calendar_event (family_id, title, notes, start_day, start_time, repeat, user_id)
			values (${family}, ${title}, ${notes}, ${startDay}, ${startTime}, ${repeat}, ${userId})
			returning id`;
		for (const name of who)
			await sql`
				insert into calendar_event_person (family_id, event_id, person_id)
				values (${family}, ${row!.id}, ${people[name]!})`;
	};
	// From this week's Monday, whatever today is: the week is full.
	const monday = (k: number) => day(k - ((new Date().getDay() + 6) % 7));
	await event('Natación', monday(-7), '17:00', ['Lucía'], 'FREQ=WEEKLY;BYDAY=MO,WE');
	await event('Fútbol', monday(-6), '18:00', ['Pablo'], 'FREQ=WEEKLY;BYDAY=TU,TH');
	await event('Reunión del cole', monday(2), '16:45', []);
	await event('Recoger el coche del taller', monday(2), '10:00', []);
	await event('Dentista', monday(4), '17:30', ['Lucía'], null, 'Llevar la tarjeta sanitaria');
	await event('Excursión a la sierra', monday(5), '09:00', ['Lucía', 'Pablo']);
	await event('Cumpleaños de la abuela', monday(6), null, ['Abuela Carmen'], 'FREQ=YEARLY');

	// Carretera: places kept with a name (Madrid and around, invented addresses).
	for (const [name, lon, lat, address] of [
		['Casa', -3.7038, 40.4168, 'Calle de Ejemplo 1, Madrid'],
		['Cole', -3.6925, 40.4232, 'Avenida del Colegio 12, Madrid'],
		['Casa de la abuela', -4.0273, 39.8628, 'Plaza Mayor 3, Toledo'],
		['Playa', -0.4815, 38.3452, 'Paseo del Mar, Alicante']
	] as const)
		await sql`
			insert into saved_place (family_id, user_id, name, lon, lat, address)
			values (${family}, ${userId}, ${name}, ${lon}, ${lat}, ${address})`;

	// Nevera: post-its for everyone, and the shopping list with a couple already bought.
	for (const [text, until] of [
		['Llamar al fontanero', null],
		['La cena está en el horno 🍲', day(0)],
		['Mañana, comida con la abuela', day(1)]
	] as const)
		await sql`
			insert into fridge_note (family_id, user_id, text, until)
			values (${family}, ${userId}, ${text}, ${until})`;
	const [list] = await sql`
		insert into fridge_note (family_id, kind, user_id, text)
		values (${family}, 'list', ${userId}, 'Lista de la compra') returning id`;
	for (const [text, done] of [
		['leche', false],
		['pan', false],
		['huevos', false],
		['tomates', false],
		['detergente', false],
		['yogures', true],
		['plátanos', true]
	] as const)
		await sql`
			insert into fridge_item (family_id, note_id, text, done, user_id)
			values (${family}, ${list!.id}, ${text}, ${done}, ${userId})`;

	// Recetas: two saved from a (made-up) cooking site, with their steps ready for the kitchen.
	const step = (text: string, timer: [string, number, string | null] | null = null) => ({
		text,
		timer: timer && { label: timer[0], minutes: timer[1], trigger: timer[2] }
	});
	for (const [title, servings, ingredients, steps, slug] of [
		[
			'Macarrones con tomate',
			4,
			[
				'400 g de macarrones',
				'500 g de tomate triturado',
				'1 cebolla',
				'200 g de carne picada',
				'Queso rallado',
				'Aceite de oliva y sal'
			],
			[
				step('Pon a hervir una olla grande de agua con sal.'),
				step('Pica la cebolla y sofríela con un chorro de aceite.', ['la cebolla', 5, null]),
				step('Añade la carne picada y deja que se dore.', ['la carne', 6, null]),
				step('Echa el tomate y deja que se haga a fuego lento mientras cueces la pasta.', [
					'la salsa',
					15,
					null
				]),
				step('Echa los macarrones al agua hirviendo y remueve.', [
					'la pasta',
					10,
					'eches la pasta'
				]),
				step('Escurre la pasta, mézclala con la salsa y sirve con queso rallado.')
			],
			'macarrones-con-tomate'
		],
		[
			'Tortilla de patatas',
			4,
			['4 patatas', '6 huevos', '1 cebolla', 'Aceite de oliva', 'Sal'],
			[
				step('Pela las patatas y córtalas en láminas finas; pica la cebolla.'),
				step('Fríe la patata y la cebolla a fuego medio en abundante aceite.', [
					'las patatas',
					20,
					null
				]),
				step('Bate los huevos con sal y mézclalos con la patata escurrida.'),
				step('Cuaja la tortilla por un lado, dale la vuelta con un plato y cuájala por el otro.')
			],
			'tortilla-de-patatas'
		]
	] as const)
		await sql`
			insert into recipe (family_id, title, servings, ingredients, steps, source_url, source_name, created_by)
			values (${family}, ${title}, ${servings}, ${sql.json([...ingredients])}, ${sql.json(steps as never)},
				${`https://recetas.ejemplo.es/${slug}`}, 'Recetas de ejemplo', ${userId})`;

	console.log(`[datos] familia de ejemplo lista (${family})`);
} finally {
	await sql.end();
}
