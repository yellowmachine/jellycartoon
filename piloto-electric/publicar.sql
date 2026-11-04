-- Lo que baja por Electric (#394), como dueño de las tablas y después de las migraciones. Aparte de
-- ellas porque el rol `electric` solo existe en el piloto. Se puede repetir.
ALTER TABLE tag REPLICA IDENTITY FULL;
ALTER TABLE series_tag REPLICA IDENTITY FULL;

GRANT SELECT ON tag, series_tag TO electric;

-- En vez de BYPASSRLS: Electric ve estas tablas enteras, y ninguna más. Quien separa a las familias
-- es la ruta de Seilide que fija el filtro.
DROP POLICY IF EXISTS tag_electric ON tag;
CREATE POLICY tag_electric ON tag FOR SELECT TO electric USING (true);
DROP POLICY IF EXISTS series_tag_electric ON series_tag;
CREATE POLICY series_tag_electric ON series_tag FOR SELECT TO electric USING (true);

ALTER PUBLICATION electric_publication_default SET TABLE tag, series_tag;
