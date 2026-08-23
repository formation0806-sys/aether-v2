import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const p = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(p)) {
    for (const raw of fs.readFileSync(p, 'utf-8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}

loadEnv();

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const ids = [
    '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
    'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
    '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
    '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
    'dcf0c503-7c1b-479c-9370-97b4cf742a54'
  ];

  const { data, error } = await supabase
    .from('memories')
    .select('id,user_id,status,memory_type,title')
    .in('id', ids);

  console.log('MEMORIES:', JSON.stringify(data, null, 2));
  console.log('ERROR:', error);

  const allIds = data!.map(m => m.id);
  console.log('ALL_IDS:', allIds);

  const { data: edges, error: edgeErr } = await supabase
    .from('memory_edges')
    .select('id,source_id,target_id,relation')
    .or(`source_id.in.(${allIds.join(',')}),target_id.in.(${allIds.join(',')})`);

  console.log('EDGES:', JSON.stringify(edges, null, 2));
  console.log('EDGE_ERROR:', edgeErr);

  const { data: events, error: eventErr } = await supabase
    .from('memory_events')
    .select('id,memory_id,action,consolidation_id')
    .in('memory_id', allIds);

  console.log('EVENTS:', JSON.stringify(events, null, 2));
  console.log('EVENT_ERROR:', eventErr);

  // Try calling the RPC with service role key
  const { data: rpcData, error: rpcError } = await supabase.rpc('consolidate_memories', {
    p_user_id: 'b8288155-65d0-4c0a-90da-2c116237087f',
    p_keep: '0a97a74a-cac6-4b70-ac8c-23f28f951cc0',
    p_merge: [
      'f7c5b99b-dc2d-4edd-87f4-36a69672a023',
      '962f14fa-c2a8-4021-a4a0-89146ceaa6a5',
      '7fcdac75-6365-4b6c-a0ff-bb82e6a62581',
      'dcf0c503-7c1b-479c-9370-97b4cf742a54'
    ]
  });

  console.log('RPC_DATA:', JSON.stringify(rpcData, null, 2));
  console.log('RPC_ERROR:', rpcError);
}

main();
