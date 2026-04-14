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

/**
 * Default PHL/PHA fields per ARP4761.
 * These are the base fields; individual projects can override label/visibility
 * via project_config.config.pha_fields.
 * type: 'text' | 'textarea' | 'select' | 'uc_select' | 'badge_select'
 */
export const DEFAULT_PHA_FIELDS = [
  { key: 'use_case_id',      label: 'Use Case',              type: 'uc_select',    required: true,  visible: true  },
  { key: 'hazard_name',      label: 'Hazard Name',           type: 'text',         required: true,  visible: true  },
  { key: 'hazard_desc',      label: 'Hazard Description',    type: 'textarea',     required: true,  visible: true  },
  { key: 'phase_of_op',      label: 'Phase of Operation',    type: 'select',       required: false, visible: true,
    options: ['—','Ground','Taxi','Takeoff','Initial Climb','En Route / Cruise','Descent','Approach','Landing','All Phases'] },
  { key: 'immediate_effect', label: 'Immediate Effect',      type: 'text',         required: false, visible: true  },
  { key: 'system_effect',    label: 'System Level Effect',   type: 'text',         required: false, visible: true  },
  { key: 'aircraft_effect',  label: 'Aircraft Level Effect', type: 'text',         required: false, visible: false },
  { key: 'severity',         label: 'Severity',              type: 'badge_select', required: true,  visible: true,
    options: ['—','Catastrophic','Hazardous','Major','Minor','No Safety Effect'],
    colors:  { Catastrophic: '#BF2600', Hazardous: '#FF8B00', Major: '#FFAB00', Minor: '#0065FF', 'No Safety Effect': '#00875A' } },
  { key: 'probability',      label: 'Probability',           type: 'select',       required: false, visible: true,
    options: ['—','Probable (> 10⁻⁵)','Remote (10⁻⁵ – 10⁻⁷)','Extremely Remote (10⁻⁷ – 10⁻⁹)','Extremely Improbable (< 10⁻⁹)'] },
  { key: 'dal',              label: 'DAL Requirement',       type: 'badge_select', required: false, visible: true,
    options: ['—','DAL-A','DAL-B','DAL-C','DAL-D','DAL-E'],
    colors:  { 'DAL-A':'#BF2600','DAL-B':'#FF8B00','DAL-C':'#FFAB00','DAL-D':'#0065FF','DAL-E':'#00875A' } },
  { key: 'failure_condition',label: 'Failure Condition',     type: 'text',         required: false, visible: false },
  { key: 'mitigation',       label: 'Mitigation / Action',   type: 'textarea',     required: false, visible: true  },
  { key: 'remarks',          label: 'Remarks',               type: 'textarea',     required: false, visible: false },
];

/** Merge DEFAULT_PHA_FIELDS with project overrides from project_config.config.pha_fields */
export function effectivePHAFields(projectConfig) {
  const overrides = projectConfig?.config?.pha_fields || {};
  return DEFAULT_PHA_FIELDS.map(f => ({ ...f, ...(overrides[f.key] || {}) }));
}

/**
 * Default FHA fields per ARP4761.
 * Stored in hazards.data JSONB, analysis_type='FHA'.
 */
export const DEFAULT_FHA_FIELDS = [
  { key: 'failure_condition', label: 'Failure Condition',    type: 'text',         required: true,  visible: true  },
  { key: 'phase_of_op',       label: 'Phase of Operation',   type: 'select',       required: false, visible: true,
    options: ['—','Ground','Taxi','Takeoff','Initial Climb','En Route / Cruise','Descent','Approach','Landing','All Phases'] },
  { key: 'effect_local',      label: 'Local Effect',         type: 'text',         required: false, visible: true  },
  { key: 'effect_system',     label: 'System Effect',        type: 'text',         required: false, visible: true  },
  { key: 'effect_aircraft',   label: 'Aircraft Effect',      type: 'text',         required: false, visible: false },
  { key: 'classification',    label: 'Classification',       type: 'badge_select', required: true,  visible: true,
    options: ['—','Catastrophic','Hazardous','Major','Minor','No Safety Effect'],
    colors:  { Catastrophic: '#BF2600', Hazardous: '#FF8B00', Major: '#FFAB00', Minor: '#0065FF', 'No Safety Effect': '#00875A' } },
  { key: 'probability',       label: 'Probability',          type: 'select',       required: false, visible: true,
    options: ['—','Probable (> 10⁻⁵)','Remote (10⁻⁵ – 10⁻⁷)','Extremely Remote (10⁻⁷ – 10⁻⁹)','Extremely Improbable (< 10⁻⁹)'] },
  { key: 'dal',               label: 'DAL',                  type: 'badge_select', required: false, visible: true,
    options: ['—','DAL-A','DAL-B','DAL-C','DAL-D','DAL-E'],
    colors:  { 'DAL-A':'#BF2600','DAL-B':'#FF8B00','DAL-C':'#FFAB00','DAL-D':'#0065FF','DAL-E':'#00875A' } },
  { key: 'mitigation_avoid',  label: 'Mitigation/Avoidance', type: 'textarea',     required: false, visible: true  },
  { key: 'safety_measures',   label: 'Safety Measures',      type: 'textarea',     required: false, visible: true  },
  { key: 'requirements',      label: 'Requirements',         type: 'text',         required: false, visible: true  },
  { key: 'remarks',           label: 'Remarks',              type: 'textarea',     required: false, visible: false },
];

export function effectiveFHAFields(projectConfig) {
  const overrides = projectConfig?.config?.fha_fields || {};
  return DEFAULT_FHA_FIELDS.map(f => ({ ...f, ...(overrides[f.key] || {}) }));
}
