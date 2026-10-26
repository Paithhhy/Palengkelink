-- PalengkeLink | 016 | Vendor profile and cover pictures: PNG or JPEG only (WebP is no longer accepted).
-- Run AFTER 015, as the owner, in the Neon SQL Editor. Safe to run more than once.
-- Neon SQL Editor note: no semicolons inside comments or text in this file (the editor splits on them).
-- That is why the picture pattern writes the semicolon after image/png in a data URL as [\x3b] (the same character, in brackets so the b of base64 is not read as part of it).
-- The website re-saves every chosen picture as a small JPEG before sending it, so this only matters for someone
-- calling the API directly.
BEGIN;

-- 1) The function vendors save their profile with: refuse anything but a PNG or JPEG picture
CREATE OR REPLACE FUNCTION fn_vendor_update_profile(p_business_name text, p_contact text, p_address text, p_bio text, p_avatar text, p_cover text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_vendor int := fn_current_vendor_id();
BEGIN
  IF v_vendor IS NULL THEN RAISE EXCEPTION 'Not a vendor session'; END IF;
  IF NULLIF(p_avatar, '') IS NOT NULL AND (p_avatar !~ '^data:image/(jpeg|png)[\x3b]base64,[A-Za-z0-9+/=]+$' OR length(p_avatar) > 200000) THEN
    RAISE EXCEPTION 'The profile picture must be a PNG or JPEG picture.';
  END IF;
  IF NULLIF(p_cover, '') IS NOT NULL AND (p_cover !~ '^data:image/(jpeg|png)[\x3b]base64,[A-Za-z0-9+/=]+$' OR length(p_cover) > 400000) THEN
    RAISE EXCEPTION 'The cover photo must be a PNG or JPEG picture.';
  END IF;
  UPDATE vendors
     SET business_name = p_business_name, contact_number = p_contact, address = p_address,
         bio = NULLIF(p_bio, ''), avatar = NULLIF(p_avatar, ''), cover = NULLIF(p_cover, '')
   WHERE vendor_id = v_vendor;
END $$;

-- 2) The table rules from 007 still allowed WebP: replace them (found by their text, whatever name PostgreSQL gave them)
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'vendors'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%webp%'
  LOOP
    EXECUTE format('ALTER TABLE vendors DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_avatar_png_jpeg;
ALTER TABLE vendors DROP CONSTRAINT IF EXISTS vendors_cover_png_jpeg;
ALTER TABLE vendors ADD CONSTRAINT vendors_avatar_png_jpeg
  CHECK (avatar ~ '^data:image/(jpeg|png)[\x3b]base64,' AND length(avatar) <= 200000) NOT VALID;
ALTER TABLE vendors ADD CONSTRAINT vendors_cover_png_jpeg
  CHECK (cover ~ '^data:image/(jpeg|png)[\x3b]base64,' AND length(cover) <= 400000) NOT VALID;

-- 3) Old pictures: if all are PNG or JPEG, mark the rules fully valid, otherwise list the vendors to fix
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(format('vendor_id %s', vendor_id), ' | ' ORDER BY vendor_id) INTO bad FROM vendors
   WHERE avatar !~ '^data:image/(jpeg|png)[\x3b]base64,' OR cover !~ '^data:image/(jpeg|png)[\x3b]base64,';
  IF bad IS NULL THEN
    ALTER TABLE vendors VALIDATE CONSTRAINT vendors_avatar_png_jpeg;
    ALTER TABLE vendors VALIDATE CONSTRAINT vendors_cover_png_jpeg;
    RAISE NOTICE 'All vendor pictures are PNG or JPEG.';
  ELSE
    RAISE NOTICE 'These vendors have an old WebP picture. They should upload a new one -> %', bad;
  END IF;
END $$;

COMMIT;
