ALTER TABLE "profiles" ADD COLUMN "public_profile" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- New accounts start with the public profile off. Accounts that already showed something to
-- everyone keep showing it: a part of the profile set to everyone (library, trophies, friends,
-- presence, gallery), discovery turned on, or a linked account shown on the profile. Everyone
-- else, and every child in a family, starts off: what strangers saw of them was the card alone,
-- and they now see the minimal one. See docs/public-profile.md.
UPDATE "profiles" p SET "public_profile" = true
WHERE (
    coalesce(p.privacy->>'library', 'friends') = 'everyone'
    OR coalesce(p.privacy->>'trophies', 'friends') = 'everyone'
    OR coalesce(p.privacy->>'friends', 'friends') = 'everyone'
    OR coalesce(p.privacy->>'presence', 'friends') = 'everyone'
    OR coalesce(p.privacy->>'gallery', 'friends') = 'everyone'
    OR p.discoverable IS TRUE
    OR EXISTS (SELECT 1 FROM "connections" c WHERE c.account_id = p.account_id AND c.hidden = false)
  )
  AND NOT EXISTS (SELECT 1 FROM "family_members" m WHERE m.account_id = p.account_id AND m.role = 'child')
  AND NOT EXISTS (SELECT 1 FROM "child_restrictions" r WHERE r.account_id = p.account_id
    AND NOT EXISTS (SELECT 1 FROM "family_members" m WHERE m.account_id = p.account_id));
