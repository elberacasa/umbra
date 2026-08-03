import { supabase } from './supabase.js';

export async function auth(accessToken: string | undefined) {
  if (!accessToken) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) return null;
  return data.user;
}
