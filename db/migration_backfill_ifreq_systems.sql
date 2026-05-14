-- Backfill system_components on existing interface requirements
-- Based on arch_connections + arch_components hierarchy (group_id in data JSONB)
-- Run once in Supabase SQL Editor

WITH RECURSIVE comp_system AS (
  -- Start from every component
  SELECT
    c.id                                         AS comp_id,
    c.comp_type,
    (c.data->>'group_id')::uuid                  AS group_id,
    CASE WHEN c.comp_type = 'Group'
              AND (c.data->>'subtype') IS NULL
         THEN c.id ELSE NULL END                 AS sys_id
  FROM arch_components c

  UNION ALL

  -- Walk up through groups until we hit a system (Group with no subtype)
  SELECT
    cs.comp_id,
    g.comp_type,
    (g.data->>'group_id')::uuid,
    CASE WHEN g.comp_type = 'Group'
              AND (g.data->>'subtype') IS NULL
         THEN g.id ELSE NULL END
  FROM comp_system cs
  JOIN arch_components g ON g.id = cs.group_id
  WHERE cs.sys_id IS NULL
    AND cs.group_id IS NOT NULL
),

resolved_systems AS (
  -- Pick the first system found per component (the walk stops when sys_id is set)
  SELECT DISTINCT ON (comp_id) comp_id, sys_id
  FROM   comp_system
  WHERE  sys_id IS NOT NULL
  ORDER  BY comp_id
),

conn_systems AS (
  -- For each connection with a requirement, collect the system IDs of both endpoints
  SELECT
    cn.requirement                                           AS req_code,
    ARRAY_REMOVE(ARRAY_AGG(DISTINCT rs_src.sys_id::text
                        ORDER BY rs_src.sys_id::text), NULL)
    || ARRAY_REMOVE(ARRAY_AGG(DISTINCT rs_tgt.sys_id::text
                           ORDER BY rs_tgt.sys_id::text), NULL) AS raw_ids
  FROM arch_connections cn

  -- Resolve source: if Port, use parent_block_id
  JOIN arch_components src_raw  ON src_raw.id = cn.source_id
  JOIN arch_components src_block ON src_block.id = CASE
    WHEN src_raw.comp_type = 'Port'
         AND (src_raw.data->>'parent_block_id') IS NOT NULL
    THEN (src_raw.data->>'parent_block_id')::uuid
    ELSE cn.source_id END

  -- Resolve target: same
  JOIN arch_components tgt_raw  ON tgt_raw.id = cn.target_id
  JOIN arch_components tgt_block ON tgt_block.id = CASE
    WHEN tgt_raw.comp_type = 'Port'
         AND (tgt_raw.data->>'parent_block_id') IS NOT NULL
    THEN (tgt_raw.data->>'parent_block_id')::uuid
    ELSE cn.target_id END

  LEFT JOIN resolved_systems rs_src ON rs_src.comp_id = src_block.id
  LEFT JOIN resolved_systems rs_tgt ON rs_tgt.comp_id = tgt_block.id

  WHERE cn.requirement IS NOT NULL
  GROUP BY cn.requirement
),

deduped AS (
  SELECT req_code,
         ARRAY(SELECT DISTINCT unnest(raw_ids) ORDER BY 1) AS sys_ids
  FROM   conn_systems
  WHERE  raw_ids IS NOT NULL AND array_length(raw_ids, 1) > 0
)

UPDATE requirements r
SET    custom_fields = jsonb_set(
         COALESCE(r.custom_fields, '{}'),
         '{system_components}',
         to_jsonb(d.sys_ids)
       )
FROM   deduped d
WHERE  r.req_code = d.req_code
  AND  d.sys_ids IS NOT NULL
  AND  array_length(d.sys_ids, 1) > 0;
