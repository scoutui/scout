UPDATE "tags" SET "color" = CASE lower("color") WHEN '#009598' THEN 'teal' WHEN '#9b6bce' THEN 'violet' WHEN '#2863ab' THEN 'blue' END
WHERE lower("color") IN ('#009598', '#9b6bce', '#2863ab');
--> statement-breakpoint
DO $$
DECLARE
  tag record;
BEGIN
  FOR tag IN SELECT "id" FROM "tags" WHERE "color" NOT IN ('teal', 'violet', 'blue', 'berry', 'orchid') ORDER BY "created_at", "id" LOOP
    UPDATE "tags" SET "color" = (
      SELECT palette.colour FROM unnest(ARRAY['teal', 'violet', 'blue', 'berry', 'orchid']) WITH ORDINALITY AS palette(colour, position)
      ORDER BY (SELECT count(*) FROM "tags" WHERE "color" = palette.colour), palette.position
      LIMIT 1
    ) WHERE "id" = tag."id";
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_color" CHECK ("tags"."color" IN ('teal', 'violet', 'blue', 'berry', 'orchid'));
