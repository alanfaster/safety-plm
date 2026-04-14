const { createClient } = supabase;

export const SUPABASE_URL     = 'https://mzlwwdspryhbsttwunva.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_BCKT9piD8JelFqA8VZPGYw_LG5IRlyy';

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Generate a short unique code for items/systems/etc. */
export function genCode(prefix) {
  return `${prefix}-${crypto.randomUUID().split('-')[0].toUpperCase()}`;
}
