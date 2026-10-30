import { beforeAll, describe, expect, mock, test } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import { family, familyMember, user } from '../db/schema.ts';
import { familyOnlyScope, familyScope, NoFamily } from '../family-scope.ts';
import type { Kitchen } from '../fridge.ts';

/**
 * «¿Dónde está el coche?» (#317), on a real Postgres (PGlite) as the app's role: each person's car,
 * the trips that go in it, and where it is, the end of its last trip or a later «Aquí y ahora».
 */
const db = drizzle(new PGlite(), { schema });
const withFamily = familyScope(db, { role: 'app_user' });
mock.module('#lib/server/family.ts', () => ({
	withFamily,
	asFamily: familyOnlyScope(db, { role: 'app_user' }),
	NoFamily
}));

const { deleteCar, listCars, myCar, myCarId, parkCar, saveCar, setMyCar, setTripCar } =
	await import('./cars.ts');
const { addTripPoints, listTrips } = await import('./trips.ts');

const kitchen = (userId: string, familyId = 'A'): Kitchen => ({
	familyId,
	userId,
	run: (fn) => withFamily(userId, (tx) => fn(tx))
});
const ana = kitchen('ana');
const alberto = kitchen('alberto');
const otra = kitchen('otra', 'B');

const person = (id: string) => ({
	id,
	name: id === 'ana' ? 'Ana' : id,
	email: `${id}@test.es`,
	createdAt: new Date(),
	updatedAt: new Date()
});

/** A short drive, ending `endsAgo` ms ago at `end`. */
const drive = (endsAgo: number, end: [number, number]) => {
	const t = Date.now() - endsAgo;
	return [
		{ t: t - 60_000, at: [end[0] - 0.01, end[1]] as [number, number], speed: 15 },
		{ t, at: end, speed: 0 }
	];
};

beforeAll(async () => {
	await migrate(db, { migrationsFolder: `${import.meta.dir}/../../../../drizzle` });
	await db.execute(sql`create role app_user nosuperuser nobypassrls`);
	await db.execute(sql`grant usage on schema public to app_user`);
	await db.execute(
		sql`grant select, insert, update, delete on all tables in schema public to app_user`
	);
	await db.execute(sql`grant usage, select on all sequences in schema public to app_user`);
	await db.insert(user).values(['ana', 'alberto', 'otra'].map(person));
	await db.insert(family).values([
		{ id: 'A', name: 'Casa A' },
		{ id: 'B', name: 'Casa B' }
	]);
	await db.insert(familyMember).values([
		{ userId: 'ana', familyId: 'A', role: 'admin' },
		{ userId: 'alberto', familyId: 'A' },
		{ userId: 'otra', familyId: 'B', role: 'admin' }
	]);
});

describe('cars', () => {
	test('none, no car; the first one added is its adder’s', async () => {
		expect(await listCars(ana)).toEqual([]);
		expect(await myCar(ana)).toBeNull();
		await saveCar(ana, null, 'El rojo');
		const [rojo] = await listCars(ana);
		expect(rojo).toMatchObject({ name: 'El rojo', place: null });
		expect(await myCarId(ana)).toBe(rojo!.id);
		// Another family’s, not seen.
		expect(await listCars(otra)).toEqual([]);
	});

	test('a trip goes in its driver’s car, and leaves it at its end', async () => {
		const [rojo] = await listCars(ana);
		await setMyCar(alberto, rojo!.id);
		await addTripPoints(alberto, drive(30 * 60_000, [-3.7, 40.4]), null);
		const [trip] = await listTrips(alberto);
		expect(trip!.carId).toBe(rojo!.id);
		const [seen] = await listCars(ana);
		expect(seen!.place).toMatchObject({ at: [-3.7, 40.4], by: 'alberto', trip: true });
	});

	test('«Aquí y ahora» after it wins, with its note; a later trip wins again', async () => {
		const [rojo] = await listCars(ana);
		expect(await parkCar(ana, rojo!.id, [-3.71, 40.41], 12, 'Planta -2')).toBe(true);
		expect((await myCar(alberto))!.place).toMatchObject({
			at: [-3.71, 40.41],
			by: 'Ana',
			note: 'Planta -2',
			trip: false
		});
		// Its trip is untouched.
		const [trip] = await listTrips(alberto);
		expect(trip!.distance).toBeGreaterThan(0);
		// Ending a few seconds later: its positions are kept to the second, the mark to the ms.
		await addTripPoints(ana, drive(-3000, [-3.8, 40.5]), null);
		expect((await myCar(ana))!.place).toMatchObject({ at: [-3.8, 40.5], trip: true, note: null });
	});

	test('a trip moved to another car, or none', async () => {
		await saveCar(alberto, null, 'La furgo');
		const furgo = (await listCars(ana)).find((c) => c.name === 'La furgo')!;
		// Alberto already had one: still the red one.
		expect(await myCarId(alberto)).not.toBe(furgo.id);
		const [trip] = await listTrips(ana);
		await setTripCar(ana, trip!.id, furgo.id);
		expect((await listCars(ana)).find((c) => c.id === furgo.id)!.place).toMatchObject({
			at: [-3.8, 40.5]
		});
		// Not someone else’s trip.
		await setTripCar(alberto, trip!.id, null);
		expect((await listTrips(ana))[0]!.carId).toBe(furgo.id);
	});

	test('not another family’s car', async () => {
		const [rojo] = await listCars(ana);
		expect(await parkCar(otra, rojo!.id, [0, 0], null, null)).toBe(false);
		await setMyCar(otra, rojo!.id);
		expect(await myCarId(otra)).toBeNull();
	});

	test('gone: its trips stay without a car, and its drivers without one', async () => {
		const [furgo] = (await listCars(ana)).filter((c) => c.name === 'La furgo');
		await setMyCar(ana, furgo!.id);
		await deleteCar(ana, furgo!.id);
		expect(await myCarId(ana)).toBeNull();
		expect((await listTrips(ana))[0]!.carId).toBeNull();
	});
});
