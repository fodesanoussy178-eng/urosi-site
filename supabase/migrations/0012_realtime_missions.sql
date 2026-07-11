-- 0012 : flux missions en temps reel — la table missions est publiee sur
-- supabase_realtime (la RLS s'applique : seules les missions visibles par le
-- client declenchent des evenements chez lui).

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.missions;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
