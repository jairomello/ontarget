-- Migração 0002: adiciona a chave primária composta de `baseline_values`
-- (docs/architecture.md §4: PRIMARY KEY(baseline_id, task_id)).
-- SQLite não altera PK com ALTER TABLE: reconstrói a tabela.
CREATE TABLE `baseline_values_new` (
	`baseline_id` text NOT NULL,
	`task_id` text NOT NULL,
	`start` integer,
	`finish` integer,
	`duration` integer,
	`work` integer,
	`cost` real,
	CONSTRAINT `baseline_values_pk` PRIMARY KEY (`baseline_id`, `task_id`),
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
)--> statement-breakpoint
INSERT INTO `baseline_values_new` (`baseline_id`, `task_id`, `start`, `finish`, `duration`, `work`, `cost`)
SELECT `baseline_id`, `task_id`, `start`, `finish`, `duration`, `work`, `cost` FROM `baseline_values`--> statement-breakpoint
DROP TABLE `baseline_values`--> statement-breakpoint
ALTER TABLE `baseline_values_new` RENAME TO `baseline_values`--> statement-breakpoint
CREATE INDEX `ix_baseline_values_task` ON `baseline_values` (`task_id`);
