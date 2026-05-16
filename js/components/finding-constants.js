/**
 * Shared finding status/transition constants.
 * Single source of truth for review-checklist.js and review-findings.js.
 */

export const FINDING_STATUS_LABELS = {
  open:      'Open',
  resolved:  'Resolved – pending verification',
  closed:    'Closed',
  rejected:  'Rejected',
  duplicate: 'Duplicate',
};

export const FINDING_STATUS_CLASSES = {
  open:      'rv-fs-open',
  resolved:  'rv-fs-fixed',
  closed:    'rv-fs-closed',
  rejected:  'rv-fs-closed',
  duplicate: 'rv-fs-closed',
};

// Valid transitions (from → [to])
export const TRANSITIONS = {
  open:     ['accepted', 'rejected'],
  accepted: ['fixed', 'rejected'],
  fixed:    ['closed', 'accepted'],
  closed:   [],
  rejected: [],
};

// Human-readable labels for transition actions
export const TRANSITION_LABELS = {
  accepted: 'Accept',
  fixed:    'Mark as Implemented',
  closed:   'Confirm & Close',
  rejected: 'Reject',
};

// Transitions that require a written comment before confirming
export const COMMENT_REQUIRED = new Set(['rejected', 'closed']);

export const SEVERITY_LABELS  = { critical:'Critical', major:'Major', minor:'Minor', observation:'Observation' };
export const SEVERITY_CLASSES = { critical:'rv-sev-critical', major:'rv-sev-major', minor:'rv-sev-minor', observation:'rv-sev-observation' };
