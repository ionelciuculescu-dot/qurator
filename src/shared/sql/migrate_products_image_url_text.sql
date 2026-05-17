-- Asigură că image_url (și affiliate_url) pot stoca URL-uri complete (fără tăiere VARCHAR).
-- Rulează în Supabase → SQL Editor dacă coloanele au fost create cu VARCHAR scurt.
--
-- Verificare înainte:
--   SELECT column_name, data_type, character_maximum_length
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'products'
--     AND column_name IN ('image_url', 'affiliate_url');

ALTER TABLE public.products
  ALTER COLUMN image_url TYPE TEXT USING image_url::text;

ALTER TABLE public.products
  ALTER COLUMN affiliate_url TYPE TEXT USING affiliate_url::text;
