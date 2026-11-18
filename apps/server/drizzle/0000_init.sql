CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text NOT NULL,
	`resource_id` text NOT NULL,
	`units` real DEFAULT 1 NOT NULL,
	`work` integer,
	`cost` real,
	`actual_work` integer,
	`actual_cost` real,
	`start` integer,
	`finish` integer,
	`proposed` integer DEFAULT false NOT NULL,
	`notes` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_id`) REFERENCES `resources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_assign_unique` ON `assignments` (`task_id`,`resource_id`);--> statement-breakpoint
CREATE INDEX `ix_assign_task` ON `assignments` (`task_id`);--> statement-breakpoint
CREATE INDEX `ix_assign_resource` ON `assignments` (`resource_id`);--> statement-breakpoint
CREATE TABLE `baseline_values` (
	`baseline_id` text NOT NULL,
	`task_id` text NOT NULL,
	`start` integer,
	`finish` integer,
	`duration` integer,
	`work` integer,
	`cost` real,
	FOREIGN KEY (`baseline_id`) REFERENCES `baselines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_baseline_values_task` ON `baseline_values` (`task_id`);--> statement-breakpoint
CREATE TABLE `baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'baseline' NOT NULL,
	`saved_at` integer NOT NULL,
	`scope` text DEFAULT 'project' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_baselines_project` ON `baselines` (`project_id`);--> statement-breakpoint
CREATE TABLE `calendar_exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`date` integer,
	`is_working` integer DEFAULT false NOT NULL,
	`name` text,
	`start_time` text,
	`end_time` text,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_cal_exceptions_cal` ON `calendar_exceptions` (`calendar_id`,`date`);--> statement-breakpoint
CREATE TABLE `calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`weekly_mask` integer DEFAULT 62 NOT NULL,
	`working_hours_start` text DEFAULT '09:00' NOT NULL,
	`working_hours_end` text DEFAULT '18:00' NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_calendars_project` ON `calendars` (`project_id`);--> statement-breakpoint
CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`old_value` text,
	`new_value` text,
	`changed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_log_project_time` ON `change_log` (`project_id`,`changed_at`);--> statement-breakpoint
CREATE TABLE `custom_field_values` (
	`field_id` text NOT NULL,
	`entity_id` text NOT NULL,
	`value_text` text,
	`value_num` real,
	`value_date` integer,
	FOREIGN KEY (`field_id`) REFERENCES `custom_fields`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_cf_values_entity` ON `custom_field_values` (`entity_id`);--> statement-breakpoint
CREATE TABLE `custom_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`formula` text,
	`config` text,
	`show_indicator` integer DEFAULT false NOT NULL,
	`indicator_rules` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_custom_fields_project` ON `custom_fields` (`project_id`,`entity_type`);--> statement-breakpoint
CREATE TABLE `import_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`format` text NOT NULL,
	`mapping` text DEFAULT '{}' NOT NULL,
	`sample` text
);
--> statement-breakpoint
CREATE TABLE `library_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`project_id` text,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ix_library_project` ON `library_items` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text,
	`color` text DEFAULT '#4f46e5' NOT NULL,
	`start` integer,
	`finish` integer,
	`status_date` integer,
	`calendar_id` text,
	`default_task_type` text DEFAULT 'fixed_duration' NOT NULL,
	`default_scheduling_mode` text DEFAULT 'auto' NOT NULL,
	`percent_complete` real DEFAULT 0 NOT NULL,
	`budget` real,
	`notes` text,
	`archived` integer DEFAULT false NOT NULL,
	`template_key` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`team_id` text,
	`name` text NOT NULL,
	`initials` text,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`type` text DEFAULT 'work' NOT NULL,
	`max_units` real DEFAULT 1 NOT NULL,
	`standard_rate` real DEFAULT 0 NOT NULL,
	`cost_per_use` real DEFAULT 0 NOT NULL,
	`calendar_id` text,
	`email` text,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ix_resources_project` ON `resources` (`project_id`);--> statement-breakpoint
CREATE TABLE `snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ix_snapshots_project` ON `snapshots` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_links` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`predecessor_id` text NOT NULL,
	`successor_id` text NOT NULL,
	`type` text DEFAULT 'fs' NOT NULL,
	`lag_ms` integer DEFAULT 0 NOT NULL,
	`cross_project_ref` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_links_unique` ON `task_links` (`predecessor_id`,`successor_id`,`type`);--> statement-breakpoint
CREATE INDEX `ix_links_pred` ON `task_links` (`predecessor_id`);--> statement-breakpoint
CREATE INDEX `ix_links_succ` ON `task_links` (`successor_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`parent_id` text,
	`outline_level` integer DEFAULT 0 NOT NULL,
	`outline_number` text DEFAULT '1' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`is_summary` integer DEFAULT false NOT NULL,
	`is_milestone` integer DEFAULT false NOT NULL,
	`is_inactive` integer DEFAULT false NOT NULL,
	`scheduling_mode` text DEFAULT 'auto' NOT NULL,
	`is_placeholder` integer DEFAULT false NOT NULL,
	`task_type` text DEFAULT 'fixed_duration' NOT NULL,
	`effort_driven` integer DEFAULT true NOT NULL,
	`constraint_type` text,
	`constraint_date` integer,
	`deadline` integer,
	`manual_start` integer,
	`manual_finish` integer,
	`manual_duration` integer,
	`start` integer,
	`finish` integer,
	`duration` integer,
	`duration_unit` text DEFAULT 'day',
	`work` integer,
	`cost` real,
	`fixed_cost` real,
	`actual_start` integer,
	`actual_finish` integer,
	`actual_duration` integer,
	`actual_work` integer,
	`actual_cost` real,
	`percent_complete` real DEFAULT 0 NOT NULL,
	`physical_percent` real,
	`duration_estimated` integer DEFAULT false NOT NULL,
	`priority` integer DEFAULT 500 NOT NULL,
	`calendar_id` text,
	`wbs_code` text,
	`recurrence` text,
	`segments` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ix_tasks_proj_order` ON `tasks` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `ix_tasks_parent` ON `tasks` (`project_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `ix_tasks_outline` ON `tasks` (`project_id`,`outline_number`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text DEFAULT '#0ea5e9' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
