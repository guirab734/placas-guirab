CREATE TRIGGER `lojas_code_alias_insert` BEFORE INSERT ON `lojas`
WHEN EXISTS (SELECT 1 FROM plate_code_aliases WHERE code = NEW.code AND plate_id != NEW.id)
BEGIN SELECT RAISE(ABORT, 'plate code collision'); END;
--> statement-breakpoint
CREATE TRIGGER `lojas_code_alias_update` BEFORE UPDATE OF code ON `lojas`
WHEN EXISTS (SELECT 1 FROM plate_code_aliases WHERE code = NEW.code AND plate_id != NEW.id)
BEGIN SELECT RAISE(ABORT, 'plate code collision'); END;
--> statement-breakpoint
CREATE TRIGGER `alias_code_lojas_insert` BEFORE INSERT ON `plate_code_aliases`
WHEN EXISTS (SELECT 1 FROM lojas WHERE code = NEW.code AND id != NEW.plate_id)
BEGIN SELECT RAISE(ABORT, 'plate code collision'); END;
