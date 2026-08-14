-- 003_aeo_pilot_lujosinartificios.sql
-- Añade el segundo proyecto del piloto AEO: Lujo Sin Artificios (Índico + Caribe).
-- Motivo: Giora 13-ago-2026 13:21 — «avanzar y comenzar con otros productos, por ejemplo el
-- lujosinartificios». Baseline de la web en RESEARCH/AEO_BASELINE_LUJOSINARTIFICIOS_2026_08_13.md.
--
-- REEQUILIBRADO 13-ago 13:50 a petición de Larry, con el dato de posiciones de GSC detrás:
-- Maldivas concentra el 44 % de las impresiones pero la web compite allí en posición media 24;
-- en el Caribe pequeño ya estamos entre el 6º y el 14º. Se mide donde se puede ganar.
--   4 prompts de Caribe nicho + 1 comercial de marca + 1 de Maldivas COMO CONTROL
--   (sin el control no podremos distinguir una mejora real de una subida general del sector).
--
-- Ningún prompt es inventado: cada uno tiene detrás una página publicada que puede responderlo,
-- verificada hoy. Si no hay página, no entra.
--   1 → /destinos/san-vicente/guia/      (1.529 palabras; «Las islas del archipiélago», «Para quién son»)
--   2 → /destinos/san-bartolome/guia/    (1.425 palabras; «Cuándo ir», «Las zonas de la isla»)
--   3 → /destinos/anguila/guia/          (1.399 palabras; «Las playas y zonas»)
--   4 → /destinos/turks-and-caicos/guia/ (1.654 palabras; «Las islas del archipiélago»)
--   5 → /quienes-somos/ + home (TravelAgency, CICMA 2283) + las 20+ fichas del Caribe
--   6 → /destinos/maldivas/guia/         (sección «¿Maldivas o Seychelles?») — CONTROL
--
-- Mercado ES en los seis: las 25 consultas top de GSC (30 días) están todas en español.

insert into public.aeo_projects (
  id,
  slug,
  name,
  brand_name,
  brand_aliases,
  brand_domains
) values (
  '00000000-0000-4000-8000-000000000002',
  'lujosinartificios',
  'Lujo Sin Artificios AEO',
  'Lujo Sin Artificios',
  array['LujoSinArtificios', 'Viajes Scibasku', 'Scibasku'],
  array['lujosinartificios.com', 'viajesscibasku.com']
)
on conflict (slug) do nothing;

insert into public.aeo_prompts (id, project_id, stable_key, market)
values
  ('10000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000002', 'es-granadinas-que-isla',     'ES'),
  ('10000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000002', 'es-san-bartolome-cuando-ir', 'ES'),
  ('10000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000002', 'es-anguila-playas-resorts',  'ES'),
  ('10000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000002', 'es-turks-caicos-que-isla',   'ES'),
  ('10000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000002', 'es-agencias-caribe-lujo',    'ES'),
  ('10000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000002', 'es-maldivas-o-seychelles',   'ES')
on conflict (project_id, stable_key) do nothing;

insert into public.aeo_prompt_versions (id, prompt_id, version, text, intent)
values
  ('20000000-0000-4000-8000-000000000011', '10000000-0000-4000-8000-000000000011', 1, 'Qué isla elegir en San Vicente y las Granadinas para un viaje de lujo', 'informational'),
  ('20000000-0000-4000-8000-000000000012', '10000000-0000-4000-8000-000000000012', 1, 'Cuándo ir a San Bartolomé y para qué tipo de viajero es', 'informational'),
  ('20000000-0000-4000-8000-000000000013', '10000000-0000-4000-8000-000000000013', 1, 'Mejores playas y resorts de Anguila para una escapada', 'commercial'),
  ('20000000-0000-4000-8000-000000000014', '10000000-0000-4000-8000-000000000014', 1, 'Turks y Caicos: qué isla elegir y dónde alojarse', 'commercial'),
  ('20000000-0000-4000-8000-000000000015', '10000000-0000-4000-8000-000000000015', 1, 'Agencias españolas especializadas en viajes de lujo al Caribe', 'commercial'),
  -- CONTROL: destino donde hoy competimos en posición 24. Si sube esto y no el Caribe, el efecto no es nuestro.
  ('20000000-0000-4000-8000-000000000016', '10000000-0000-4000-8000-000000000016', 1, '¿Maldivas o Seychelles para una luna de miel? Diferencias reales', 'informational')
on conflict (prompt_id, version) do nothing;
