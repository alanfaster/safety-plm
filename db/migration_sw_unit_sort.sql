-- Add sort_order to sw_units for drag-to-reorder
ALTER TABLE sw_units ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
