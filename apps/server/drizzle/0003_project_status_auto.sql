-- Migração 0003: flag de data de status automática (specs/tracking —
-- "Data de status": atualiza para a data corrente quando configurado).
ALTER TABLE `projects` ADD COLUMN `status_auto` integer DEFAULT false;
