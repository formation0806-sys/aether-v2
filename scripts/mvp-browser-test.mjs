// MVP Browser Test - verifies auth + chat + conversation history
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const SUPABASE_URL = 'https://sqbdxttrdmlwlmslzznv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UbFoSW5KLS6876B4dRgRNQ_BNOlqPOQ';
const EMAIL = 'ps3415286@gmail.com';
const PASSWORD = '-XpSQWjH+/3-7R9';
const LOCAL_URL = 'http://localhost:3000';

const results = [];

function log(test, pass, detail) {
  results.push({ test, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${test}${detail ? ' - ' + detail : ''}`);
}

async function main() {
  // TEST 1: Auth - Sign in
  console.log('\n=== TEST 1: Auth Sign In ===');
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  
  if (authError) {
    log('Auth sign in', false, authError.message);
    return;
  }
  log('Auth sign in', true, `User: ${authData.user.email}`);
  const accessToken = authData.session.access_token;
  const refreshToken = authData.session.refresh_token;
  const userId = authData.user.id;
  
  // Build cookies that Supabase SSR expects
  // The @supabase/ssr package reads cookies by name pattern
  const cookieHeader = `sb-sqbdxttrdmlwlmslzznv-auth-token=${accessToken}; sb-sqbdxttrdmlwlmslzznv-auth-token-code-verifier=`;

  // TEST 2: Chat - Send message
  console.log('\n=== TEST 2: Chat Send Message ===');
  const chatRes = await fetch(`${LOCAL_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    },
    body: JSON.stringify({ message: 'My name is Prince.' }),
  });
  const chatData = await chatRes.json();
  log('Chat send message', chatRes.ok && typeof chatData.response === 'string', 
      chatRes.ok ? `Response length: ${chatData.response?.length}` : chatData.error);

  // TEST 3: Verify message persisted
  console.log('\n=== TEST 3: Message Persistence ===');
  await new Promise(r => setTimeout(r, 1000));
  const { data: messages, error: msgError } = await supabase
    .from('messages')
    .select('role,content,created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);
  
  if (msgError) {
    log('Message persistence', false, msgError.message);
  } else {
    const userMsg = messages.find(m => m.role === 'user' && m.content === 'My name is Prince.');
    const assistantMsg = messages.find(m => m.role === 'assistant');
    log('User message saved', !!userMsg, userMsg ? `at ${userMsg.created_at}` : 'not found');
    log('Assistant message saved', !!assistantMsg, assistantMsg ? `at ${assistantMsg.created_at}` : 'not found');
  }

  // TEST 4: Conversation History - time window query
  console.log('\n=== TEST 4: Conversation History Query ===');
  if (messages && messages.length > 0) {
    const lastMsg = messages[0];
    const firstMsg = messages[messages.length - 1];
    const from = new Date(firstMsg.created_at).toISOString();
    const to = new Date(new Date(lastMsg.created_at).getTime() + 5000).toISOString();
    
    const { data: historyMsgs, error: histError } = await supabase
      .from('messages')
      .select('role,content,created_at')
      .eq('user_id', userId)
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: true });
    
    if (histError) {
      log('History query', false, histError.message);
    } else {
      log('History query returns messages', historyMsgs.length > 0, `${historyMsgs.length} messages found`);
      const hasUserMsg = historyMsgs.some(m => m.role === 'user' && m.content === 'My name is Prince.');
      const hasAssistantMsg = historyMsgs.some(m => m.role === 'assistant');
      log('History has user message', hasUserMsg);
      log('History has assistant message', hasAssistantMsg);
    }
  }

  // TEST 5: Second conversation (separation test)
  console.log('\n=== TEST 5: Second Conversation ===');
  const chatRes2 = await fetch(`${LOCAL_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': cookieHeader,
    },
    body: JSON.stringify({ message: 'Tell me a short joke.' }),
  });
  const chatData2 = await chatRes2.json();
  log('Second chat message', chatRes2.ok && typeof chatData2.response === 'string',
      chatRes2.ok ? `Response: ${chatData2.response?.substring(0, 60)}...` : chatData2.error);

  // TEST 6: Verify no debug strings in responses
  console.log('\n=== TEST 6: No Debug Strings ===');
  const allResponses = [chatData.response, chatData2.response].filter(Boolean);
  const hasDebugStrings = allResponses.some(r => 
    r.includes('[CHAT]') || r.includes('[CHAT-TRACE]') || r.includes('[HISTORY]') || r.includes('AETHER_APP_LOCAL_OK')
  );
  log('No debug strings in responses', !hasDebugStrings);

  // SUMMARY
  console.log('\n=== SUMMARY ===');
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`${passed}/${total} tests passed`);
  if (passed === total) {
    console.log('MVP_GATE=PASS');
  } else {
    console.log('MVP_GATE=FAIL');
  }
}

main().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
