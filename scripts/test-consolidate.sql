SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';
SELECT auth.uid() as auth_uid;
SELECT consolidate_memories(
  'b8288155-65d0-4c0a-90da-2c116237087f'::uuid,
  '0a97a74a-cac6-4b70-ac8c-23f28f951cc0'::uuid,
  ARRAY['f7c5b99b-dc2d-4edd-87f4-36a69672a023','962f14fa-c2a8-4021-a4a0-89146ceaa6a5','7fcdac75-6365-4b6c-a0ff-bb82e6a62581','dcf0c503-7c1b-479c-9370-97b4cf742a54']::uuid[]
) as result;
