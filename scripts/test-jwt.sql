SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';
SELECT current_setting('request.jwt.claims', true) as claims;
SELECT auth.uid() as auth_uid;
