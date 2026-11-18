-- Migração 0004: adiciona a chave primária composta de `custom_field_values`
-- (docs/architecture.md §4: PRIMARY KEY(field_id, entity_id)).
-- SQLite não altera PK com ALTER TABLE: reconstrói a tabela.
CREATE TABLE `custom_field_values_new` (
	`field_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`value_text` text,
	`value_num` real,
	`value_date` integer,
	CONSTRAINT `custom_field_values_pk` PRIMARY KEY (`field_id`, `entity_id`),
	FOREIGN KEY (`field_id`) REFERENCES `custom_fields`(`id`) ON UPDATE no action ON DELETE cascade
)--> statement-breakpoint
INSERT INTO `custom_field_values_new` (`field_id`, `entity_id`, `value_text`, `value_num`, `value_date`)
SELECT `field_id`, `entity_id`, `value_text`, `value_num`, `value_date` FROM `custom_field_values`--> statement-breakpoint
DROP TABLE `custom_field_values`--> statement-breakpoint
ALTER TABLE `custom_field_values_new` RENAME TO `custom_field_values`--> statement-breakpoint
CREATE INDEX `ix_cf_values_entity` ON `custom_field_values` (`entity_id`);
