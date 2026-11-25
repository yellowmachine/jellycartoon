-- Custom SQL migration file, put your code below! --
-- Butane and pellet (#628): what was noted before spots and units. Each fuel gets its one spot, with
-- what the family said one lasts; each start («empezada», one a day) becomes a unit until the next
-- one, as it was understood. It comes from the oldest purchase with any left by that day; with none,
-- it was there before anything was noted (from_stock false) and takes nothing from the full ones.
INSERT INTO "fuel_spot" ("family_id", "fuel_id", "guess_days")
SELECT "family_id", "id", "guess_days" FROM "fuel";
--> statement-breakpoint
DO $$
DECLARE
	s record;
	bought integer;
BEGIN
	FOR s IN
		SELECT d.family_id, d.fuel_id, d.day, p.id AS spot_id,
			lead(d.day) OVER (PARTITION BY d.fuel_id ORDER BY d.day) AS next_day
		FROM (
			SELECT DISTINCT family_id, fuel_id, day FROM fuel_event WHERE kind = 'empezada'
		) d
		JOIN fuel_spot p ON p.fuel_id = d.fuel_id
		ORDER BY d.fuel_id, d.day
	LOOP
		SELECT e.id INTO bought
		FROM fuel_event e
		WHERE e.fuel_id = s.fuel_id AND e.kind = 'compra' AND e.day <= s.day
			AND e.quantity > (SELECT count(*) FROM fuel_unit u WHERE u.purchase_id = e.id)
		ORDER BY e.day, e.id
		LIMIT 1;
		INSERT INTO fuel_unit (family_id, fuel_id, spot_id, started_on, ended_on, from_stock, purchase_id)
		VALUES (s.family_id, s.fuel_id, s.spot_id, s.day, s.next_day, bought IS NOT NULL, bought);
	END LOOP;
END $$;
