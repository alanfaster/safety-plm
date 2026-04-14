const { createClient } = supabase;

export const SUPABASE_URL     = 'https://mzlwwdspryhbsttwunva.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_BCKT9piD8JelFqA8VZPGYw_LG5IRlyy';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Legacy short code (kept for compatibility) */
export function genCode(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}

/**
 * Extract acronym initials from a name.
 * "Electric Parking Brake" → "EPB", "System 1" → "S1"
 */
export function nameInitials(name, maxLen = 4) {
  return (name || '').toUpperCase()
    .replace(/[^A-Z0-9\s\-_]/g, '')
    .split(/[\s\-_]+/)
    .map(w => w.charAt(0))
    .filter(Boolean)
    .join('')
    .substring(0, maxLen) || 'X';
}

/**
 * Build a structured, readable code.
 * buildCode('REQ', { domain:'SW', projectName:'Brake', systemName:'ECU', index:1 })
 * → "REQ-SW-BRK-ECU-001"
 */
export function buildCode(type, { domain, projectName, systemName, index } = {}) {
  const parts = [type];
  if (domain)      parts.push(domain.toUpperCase());
  if (projectName) parts.push(nameInitials(projectName));
  if (systemName)  parts.push(nameInitials(systemName));
  parts.push(String(index || 1).padStart(3, '0'));
  return parts.join('-');
}

/**
 * Get next sequential index by counting existing records.
 * Usage: nextIndex('systems', { item_id: itemId })
 */
export async function nextIndex(table, conditions) {
  let q = sb.from(table).select('id', { count: 'exact', head: true });
  for (const [col, val] of Object.entries(conditions)) q = q.eq(col, val);
  const { count } = await q;
  return (count || 0) + 1;
}
