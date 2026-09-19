import { createClient } from '@supabase/supabase-js';

const url = 'https://sqbdxttrdmlwlmslzznv.supabase.co';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svr = process.env.SUPABASE_SERVICE_ROLE_KEY;
const prod = 'https://aether-v2-kappa.vercel.app';
const email = process.env.MEM_E2E_EMAIL;
const pwd = <REDACTED>

console.log('EMAIL: ' + email);
console.log('PROD: ' + prod);

const sb = createClient(url, anon);

// Sign in
console.log('\n=== SIGN IN ===');
const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({ email, pwd });
if (signInErr) { console.error('SIGNIN_ERR: ' + signInErr.message); process.exit(1); }
const token = signInData.session.access_token;
const userId = signInData.user.id;
console.log('USER_ID: ' + userId);
console.log('TOKEN_LEN: ' + token.length);

// TEST 1: Send fact
console.log('\n=== TEST 1: FACT CREATION ===');
const fact = 'My favorite programming language is Rust. [' + Date.now() + ']';
let r = await fetch(prod + '/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Cookie': 'sb-access-token=' + token },
  body: JSON.stringify({ message: fact }),
});
let d = await r.json();
console.log('STATUS: ' + r.status);
console.log('RESPONSE: ' + (d.response || d.error || '').substring(0, 150));

// Wait 60s for async processing
console.log('\n=== WAITING 60s ===');
await new Promise(function (x) { setTimeout(x, 60000); });

// Inspect database
console.log('\n=== DATABASE INSPECTION ===');
const asb = createClient(url, svr);

const { data: msgs } = await asb.from('messages').select('id,role,content').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
console.log('MESSAGES: ' + (msgs ? msgs.length : 0));
if (msgs) msgs.forEach(function (m) { console.log('  [' + m.role + '] ' + m.content.substring(0, 80)); });

const { data: jobs } = await asb.from('memory_jobs').select('id,status,error,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
console.log('JOBS: ' + (jobs ? jobs.length : 0));
if (jobs) jobs.forEach(function (j) { console.log('  [' + j.status + '] err=' + (j.error || 'none') + ' created=' + j.created_at); });

const { data: mems } = await asb.from('memories').select('id,title,fact,score').eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
console.log('MEMORIES: ' + (mems ? mems.length : 0));
if (mems) mems.forEach(function (m) { console.log('  [' + m.id + '] title=' + m.title + ' fact=' + (m.fact || '').substring(0, 50) + ' score=' + m.score); });

// TEST 2: Retrieval
console.log('\n=== TEST 2: RETRIEVAL ===');
r = await fetch(prod + '/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Cookie': 'sb-access-token=' + token },
  body: JSON.stringify({ message: 'What programming language did I say was my favorite?' }),
});
d = await r.json();
console.log('STATUS: ' + r.status);
console.log('RESPONSE: ' + (d.response || d.error || '').substring(0, 200));

// TEST 3: Paraphrase
console.log('\n=== TEST 3: PARAPHRASE ===');
r = await fetch(prod + '/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'Cookie': 'sb-access-token=' + token },
  body: JSON.stringify({ message: 'Which coding language do I prefer?' }),
});
d = await r.json();
console.log('STATUS: ' + r.status);
console.log('RESPONSE: ' + (d.response || d.error || '').substring(0, 200));

console.log('\n=== SUMMARY ===');
console.log('MEMORY_JOBS: ' + (jobs ? jobs.length : 0));
console.log('MEMORIES: ' + (mems ? mems.length : 0));

