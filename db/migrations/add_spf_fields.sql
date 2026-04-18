-- Add SPF review fields to fta_nodes
ALTER TABLE fta_nodes ADD COLUMN IF NOT EXISTS spf_justification TEXT;
ALTER TABLE fta_nodes ADD COLUMN IF NOT EXISTS spf_status TEXT DEFAULT 'pending';
ALTER TABLE fta_nodes ADD COLUMN IF NOT EXISTS spf_approver_comment TEXT;
