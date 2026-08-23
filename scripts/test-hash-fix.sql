SET request.jwt.claims = '{"sub": "b8288155-65d0-4c0a-90da-2c116237087f"}';
CREATE OR REPLACE FUNCTION public.hashtextextended(text, text) RETURNS bigint AS $$
BEGIN
  RETURN hashtextextended($1, ('x' || $2)::bit(64)::bigint);
END;
$$ LANGUAGE plpgsql;
SELECT hashtextextended('abc'::text, 'def'::text) as result;
