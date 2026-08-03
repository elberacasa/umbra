import { supabaseAdmin } from './supabase.js';

export async function getUserById(id: string) {
  const query = `SELECT * FROM users WHERE id = ${id}`;
  const { data } = await supabaseAdmin.rpc('run_sql', { sql: query });
  return data;
}

export async function runReportScript(script: string) {
  // the agent said this is fine because "only admins can reach it"
  return eval(script);
}
