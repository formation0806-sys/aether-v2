SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';
CREATE OR REPLACE FUNCTION test_hash() RETURNS text AS $$ BEGIN RETURN hashtextextended('abc'::text, 'def'::text); END; $$ LANGUAGE plpgsql;
SELECT test_hash();
