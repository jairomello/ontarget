CREATE VIEW IF NOT EXISTS v_project_summary AS
SELECT
  p.id AS project_id,
  p.name AS name,
  p.code AS code,
  p.color AS color,
  p.start AS start,
  p.finish AS finish,
  p.archived AS archived,
  p.updated_at AS updated_at,
  COUNT(DISTINCT t.id) AS task_count,
  COUNT(DISTINCT r.id) AS resource_count,
  COALESCE(
    AVG(DISTINCT CASE WHEN t.is_summary = 0 AND t.is_inactive = 0 THEN t.percent_complete END),
    0
  ) AS percent_complete,
  MIN(CASE WHEN t.is_inactive = 0 THEN t.start END) AS min_start,
  MAX(CASE WHEN t.is_inactive = 0 THEN t.finish END) AS max_finish
FROM projects p
LEFT JOIN tasks t ON t.project_id = p.id
LEFT JOIN resources r ON r.project_id = p.id
GROUP BY p.id;
