import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://sqbdxttrdmlwlmslzznv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UbFoSW5KLS6876B4dRgnRNQ_BNOlqPOQ';
const LOCAL_SERVER = 'http://localhost:3000';

const EMAIL = process.env.M2_SMOKE_EMAIL || 'ps3415286@gmail.com';
const PASSWORD = process.env.M2_SMOKE_PASSWORD || '-XpSQWjH+/3-7R9';

console.log('EMAIL: ' + EMAIL);
console.log('LOCAL_SERVER: ' + LOCAL_SERVER);

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Sign in
console.log('\n=== SIGN IN ===');
const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});
if (signInErr) {
  console.error('SIGNIN_ERR: ' + signInErr.message);
  process.exit(1);
}

const token = signInData.session?.access_token;
const userId = signInData.user.id;
console.log('USER_ID: ' + userId);
console.log('TOKEN_LEN: ' + (token?.length || 0));

// Test 1: Send "Hello Aether, reply with exactly: AETHER_CHAT_WORKS"
console.log('\n=== TEST 1: AUTHENTICATED CHAT ===');
try {
  const response = await fetch(LOCAL_SERVER + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (token || ''),
    },
    body: JSON.stringify({ message: 'Hello Aether, reply with exactly: AETHER_CHAT_WORKS' }),
  });

  console.log('HTTP_STATUS: ' + response.status);
  console.log('CONTENT_TYPE: ' + response.headers.get('content-type'));
  console.log('IS_JSON: ' + (response.headers.get('content-type')?.includes('application/json') || false));

  const data = await response.json();
  console.log('RESPONSE_DATA: ' + JSON.stringify(data));

  if (data.response) {
    console.log('RESPONSE_SUCCESS: true');
    console.log('RESPONSE_TEXT: ' + data.response);
  }
  if (data.error) {
    console.log('RESPONSE_ERROR: ' + data.error);
  }
} catch (e) {
  console.error('REQUEST_FAILED: ' + (e instanceof Error ? e.message : String(e)));
}

// Test 2: Normal conversational message
console.log('\n=== TEST 2: NORMAL CONVERSATION ===');
try {
  const response = await fetch(LOCAL_SERVER + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (token || ''),
    },
    body: JSON.stringify({ message: 'What is the capital of France?' }),
  });

  console.log('HTTP_STATUS: ' + response.status);
  const data = await response.json();
  console.log('RESPONSE_DATA: ' + JSON.stringify(data));

  if (data.response) {
    console.log('RESPONSE_SUCCESS: true');
    console.log('RESPONSE_TEXT: ' + data.response);
  }
  if (data.error) {
    console.log('RESPONSE_ERROR: ' + data.error);
  }
} catch (e) {
  console.error('REQUEST_FAILED: ' + (e instanceof Error ? e.message : String(e)));
}

// Test 3: Check message persistence
console.log('\n=== TEST 3: MESSAGE PERSISTENCE ===');
try {
  const { data: msgs, error: msgErr } = await sb
    .from('messages')
    .select('id,role,content,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (msgErr) {
    console.error('MSG_QUERY_ERR: ' + msgErr.message);
  } else {
    console.log('MESSAGES_COUNT: ' + (msgs ? msgs.length : 0));
    if (msgs) {
      msgs.forEach(function (m) {
        console.log('  [' + m.role + '] ' + (m.content || '').substring(0, 100));
      });
    }
  }
} catch (e) {
  console.error('MSG_QUERY_FAILED: ' + (e instanceof Error ? e.message : String(e)));
}

console.log('\n=== DONE ===');
