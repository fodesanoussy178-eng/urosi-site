-- 0017 : verrouillage serveur de l'acces fondateur structure.
--
-- Le front ne doit jamais etre la source d'autorite pour un bypass fondateur.
-- Cette migration force la verification cote Postgres : seul public.is_founder()
-- peut enregistrer founder_bypass / verification_method = founder.

create or replace function public.is_valid_siret(value text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  digits text := regexp_replace(coalesce(value, ''), '\D', '', 'g');
  total integer := 0;
  idx integer;
  n integer;
begin
  if length(digits) <> 14 then
    return false;
  end if;

  for idx in 1..14 loop
    n := substring(digits from 15 - idx for 1)::integer;
    if mod(idx, 2) = 0 then
      n := n * 2;
      if n > 9 then
        n := n - 9;
      end if;
    end if;
    total := total + n;
  end loop;

  return mod(total, 10) = 0;
end;
$$;

create or replace function public.guard_structure_verification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_siret text := regexp_replace(coalesce(new.siret, ''), '\D', '', 'g');
  has_founder_status boolean := coalesce(new.founder_bypass, false)
    or new.verification_status = 'founder_bypass'
    or new.verification_method = 'founder';
begin
  if has_founder_status then
    if not public.is_founder() then
      raise exception 'Acces fondateur reserve.';
    end if;

    new.siret := nullif(normalized_siret, '');
    new.founder_bypass := true;
    new.verification_status := 'founder_bypass';
    new.verification_method := 'founder';
    new.verified_at := coalesce(new.verified_at, now());
    return new;
  end if;

  new.founder_bypass := false;

  if public.is_valid_siret(normalized_siret) then
    new.siret := normalized_siret;
    new.verification_status := 'verified';
    new.verification_method := 'siret';
    new.siret_verified_at := coalesce(new.siret_verified_at, now());
    new.verified_at := coalesce(new.verified_at, new.siret_verified_at, now());
  else
    new.siret := nullif(normalized_siret, '');
    new.verification_status := case
      when new.verification_status = 'rejected' then 'rejected'
      else 'pending'
    end;
    new.verification_method := case
      when new.verification_method = 'manual' then 'manual'
      else 'siret'
    end;
    new.siret_verified_at := null;
    new.verified_at := null;
  end if;

  return new;
end;
$$;

drop trigger if exists structures_guard_verification on public.structures;
create trigger structures_guard_verification
  before insert or update of siret, verification_status, verification_method, founder_bypass
  on public.structures
  for each row execute function public.guard_structure_verification();
