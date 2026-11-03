-- «¿Sigues ahí?» (#77) by time instead of episodes: what each one chose, as minutes (2 → 1 h, 3 → 1 h 30, 4 → 2 h; never stays never).
UPDATE "kid_settings" SET "ask_after_min" = CASE "ask_every" WHEN 2 THEN 60 WHEN 3 THEN 90 WHEN 4 THEN 120 ELSE NULL END;--> statement-breakpoint
UPDATE "user_settings" SET "ask_after_min" = CASE "ask_every" WHEN 2 THEN 60 WHEN 3 THEN 90 WHEN 4 THEN 120 ELSE NULL END;
