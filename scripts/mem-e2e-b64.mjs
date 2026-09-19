import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const url = 'https://sqbdxttrdmlwlmslzznv.supabase.co';
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svr = process.env.SUPABASE_SERVICE_ROLE_KEY;
const prod = 'https://aether-v2-kappa.vercel.app';

// Read base64-encoded credentials from files
const profile = process.env.USERPROFILE;
const emailB64 = fs.readFileSync(profile + '\\.aether\\mem-e2e-email-b64.txt', 'utf8').trim();
const secretB64 = fs.readFileSync(profile + '\\.aether\\mem-e2e-pw-b64.txt', 'utf8').trim();

const memEmail = Buffer.from(emailB64, 'base64').toString('utf8');
const memSecret = Buffer.from(secretB64, 'base64').toString('utf8');

console.log('EMAIL:', memEmail);
console.log('SECRET_LEN:', memSecret.length);

console.log('\n=== SIGN IN ===');
const sb = createClient(url, anon);
const { data: signInData, error: signInErr } = await sb.auth.signInWithPassword({
  email: memEmail,
  password: <REDACTED>
});

if (signInErr) {
  console.error('SIGNIN_ERR:', signInErr.message);
  process.exit(1);
}

const token = signInData.session.access_token;
const userId = signInData.user.id;
console.log('USER_ID:', userId);
console.log('SIGNIN: SUCCESS');

console.log('\n=== TEST 1: FACT CREATION ===');
const fact = 'My favorite programming language is Rust. [' + Date.now() + ']';
let r = await fetch(prod + '/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'Cookie': 'sb-access-token=' + token,
  },
  body: JSON.stringify({ message: fact }),
});
let d = await r.json();
console.log('STATUS:', r.status);
console.log('RESPONSE:', (d.response || d.error || '').substring(0, 150));

console.log('\n=== WAITING 60s ===');
await new Promise(x => setTimeout(x, 60000));

console.log('\n=== DATABASE INSPECTION ===');
const asb = createClient(url, svr);

const { data: msgs } = await asb
  .from('messages')
  .select('id, role, content')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(5);
console.log('MESSAGES:', msgs ? msgs.length : 0);
if (msgs) msgs.forEach(m => console.log('  [' + m.role + '] ' + m.content.substring(0, 80)));

const { data: jobs } = await asb
  .from('memory_jobs')
  .select('id, status, error, created_at')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(5);
console.log('JOBS:', jobs ? jobs.length : 0);
if (jobs) jobs.forEach(j => console.log('  [' + j.status + '] err=' + (j.error || 'none') + ' created=' + j.created_at));

const { data: mems } = await asb
  .from('memories')
  .select('id, title, fact, score')
  .eq('user_id', userId)
  .order('created_at', { ascending: false })
  .limit(5);
console.log('MEMORIES:', mems ? mems.length : 0);
if (mems) mems.forEach(m => console.log('  [' + m.id + '] title=' + m.title + ' fact=' + (m.fact || '').substring(0, 50) + ' score=' + m.score));

console.log('\n=== TEST 2: RETRIEVAL ===');
r = await fetch(prod + '/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'Cookie': 'sb-access-token=' + token,
  },
  body: JSON.stringify({ message: 'What programming language did I say was my favorite?' }),
});
d = await r.json();
console.log('STATUS:', r.status);
console.log('RESPONSE:', (d.response || d.error || '').substring(0, 200));

console.log('\n=== TEST 3: PARAPHRASE ===');
r = await fetch(prod + '/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
    'Cookie': 'sb-access-token=' + token,
  },
  body: JSON.stringify({ message: 'Which coding language do I prefer?' }),
});
d = await r.json();
console.log('STATUS:', r.status);
console.log('RESPONSE:', (d.response || d.error || '').substring(0, 200));

console.log('\n=== SUMMARY ===');
console.log('JOBS:', jobs ? jobs.length : 0);
console.log('MEMORIES:', mems ? mems.length : 0);
