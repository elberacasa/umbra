import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://demo.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlbW8iLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNjE2MTY5MjAwLCJleHAiOjE5MzE4NDUyMDB9.fakeSignatureForFixtureOnly1234567890';

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
