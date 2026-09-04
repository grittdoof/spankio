-- ============================================================================
-- Modules visibles par le compte connecté, avec leur autorisation EFFECTIVE
-- (core, surcharge par utilisateur, activation de l'organisation).
--
-- Renvoie du `jsonb` et non une table : toutes les fonctions appelées par
-- l'application respectent la même convention — une valeur scalaire ou du
-- jsonb — afin que l'adaptateur de production (PostgREST) et celui des tests
-- (SQL direct) se comportent identiquement.
--
-- SECURITY INVOKER (défaut) : le RLS de l'appelant s'applique.
-- ============================================================================

create or replace function public.my_modules()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'key', m.key,
        'name', m.name,
        'description', m.description,
        'isCore', m.is_core,
        'allowed', public.can_use_module(m.key),
        'enabledForOrganisation', public.org_has_module(public.my_org_id(), m.key)
      )
      order by m.sort_order
    ),
    '[]'::jsonb
  )
  from public.modules m
$$;

revoke all on function public.my_modules() from public;
grant execute on function public.my_modules() to authenticated;
