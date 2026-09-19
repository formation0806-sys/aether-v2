// Local chat verification test
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://sqbdxttrdmlwlmslzznv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UbFoSW5KLS6876B4dRgRNQ_BNOlqPOQ';
const EMAIL = 'ps3415286@gmail.com';
const PASSWORD = '-XpSQWjH+/3-7R9';
const LOCAL_URL = 'http://localhost:3000';

async function main() {
  console.log('=== LOCAL OLLAMA 401 FIX VERIFICATION ===\n');
  
  // 1. Sign in
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  
  if (authError) {
    console.log('FAIL: Auth:', authError.message);
    return;
  }
  console.log('PASS: Sign in successful');
  const userId = authData.user.id;
  const accessToken = authData.session.access_token;
  const refreshToken = authData.session.refresh_token;
  
  // Build the cookie in Supabase SSR format
  const cookieValue = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const cookieHeader = `sb-sqbdxttrdmlwlmslzznv-auth-token=${encodeURIComponent(cookieValue)}`;

  // 2. Test chat API
  console.log('\n--- Testing /api/chat ---');
  const chatRes = await fetch(`${LOCAL_URL}/api/chat`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    },
    body: JSON.stringify({ message: 'Hello, what can you help me with?' }),
  });
  
  const status = chatRes.status;
  let body;
  try { body = await chatRes.json(); } catch { body = { error: 'unreadable' }; }
  
  console.log(`HTTP Status: ${status}`);
  if (body.response) {
    console.log(`AI Response (first 100 chars): ${body.response.substring(0, 100)}`);
  } else if (body.error) {
    console.log(`Error: ${body.error}`);
  }
  
  if (status === 200 && body.response) {
    console.log('\n=== PASS: Local chat working! No 401! ===');
  } else if (status === 401) {
    console.log('\n=== FAIL: Still getting 401 ===');
  } else {
    console.log('\n=== Status:', status, '===');
  }
}

main().catch(err => console.error('Test error:', err));
