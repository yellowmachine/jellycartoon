-- The families' ids, for the cloud's own clock (scheduler.ts): it looks at each family's agenda
-- and alarms on its own, within that family (asFamily). Only the ids, as the owner: the app's role
-- sees no family without being in one.
CREATE FUNCTION family_ids() RETURNS SETOF text
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
	AS $$ SELECT id FROM family $$;
