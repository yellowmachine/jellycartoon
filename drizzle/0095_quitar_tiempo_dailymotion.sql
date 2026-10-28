-- Dailymotion se quita del proyecto: su tiempo de pantalla, antes de quitar su columna, que dejaría
-- esas filas sin nada visto (watch_time_one_item).
DELETE FROM "watch_time" WHERE "dailymotion_id" IS NOT NULL;
