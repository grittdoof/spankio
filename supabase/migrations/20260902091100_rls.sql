-- ============================================================================
-- Row Level Security : l'isolation multi-tenant.
--
-- Deux règles de lecture de ce fichier :
--   * aucune policy n'interroge directement `public.profiles` — tout passe par
--     les fonctions SECURITY DEFINER du fichier helpers (pas de récursion) ;
--   * les privilèges SQL sont accordés explicitement, table par table. Le rôle
--     `anon` ne reçoit presque rien : les données publiques passent par une vue
--     dédiée et les écritures publiques par des fonctions contrôlées.
--
-- Fichier idempotent : chaque policy est supprimée avant d'être recréée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Privilèges de base : on part de zéro pour anon et authenticated.
-- ----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ============================================================================
-- organisations
-- ============================================================================
grant select, insert, update, delete on public.organisations to authenticated;

drop policy if exists organisations_select on public.organisations;
create policy organisations_select on public.organisations
  for select to authenticated
  using (public.is_super_admin() or id = public.my_org_id());

drop policy if exists organisations_insert on public.organisations;
create policy organisations_insert on public.organisations
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists organisations_update on public.organisations;
create policy organisations_update on public.organisations
  for update to authenticated
  using (public.is_super_admin() or (public.is_org_admin() and id = public.my_org_id()))
  with check (public.is_super_admin() or (public.is_org_admin() and id = public.my_org_id()));

drop policy if exists organisations_delete on public.organisations;
create policy organisations_delete on public.organisations
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- profiles
-- Aucune policy d'INSERT : les profils naissent uniquement du trigger
-- on_auth_user_created, ce qui rend impossible la fabrication d'un profil.
-- ============================================================================
grant select, update, delete on public.profiles to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  );

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (
    id = auth.uid()
    or public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  )
  with check (
    id = auth.uid()
    or public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  );

drop policy if exists profiles_delete on public.profiles;
create policy profiles_delete on public.profiles
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- platform_settings — lecture publique assumée : les pages légales doivent
-- être consultables sans compte. Aucune donnée personnelle n'y figure.
-- ============================================================================
grant select on public.platform_settings to anon, authenticated;
grant update on public.platform_settings to authenticated;

drop policy if exists platform_settings_select on public.platform_settings;
create policy platform_settings_select on public.platform_settings
  for select to anon, authenticated
  using (true);

drop policy if exists platform_settings_update on public.platform_settings;
create policy platform_settings_update on public.platform_settings
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================================
-- modules (catalogue)
-- ============================================================================
grant select, insert, update, delete on public.modules to authenticated;

drop policy if exists modules_select on public.modules;
create policy modules_select on public.modules
  for select to authenticated
  using (true);

drop policy if exists modules_write on public.modules;
create policy modules_write on public.modules
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ============================================================================
-- organisation_modules
-- Le super_admin CONCÈDE un module (création / retrait de la ligne) ;
-- l'admin de l'organisation l'ACTIVE ou le désactive (colonne enabled).
-- ============================================================================
grant select, insert, update, delete on public.organisation_modules to authenticated;

drop policy if exists organisation_modules_select on public.organisation_modules;
create policy organisation_modules_select on public.organisation_modules
  for select to authenticated
  using (public.is_super_admin() or organisation_id = public.my_org_id());

drop policy if exists organisation_modules_insert on public.organisation_modules;
create policy organisation_modules_insert on public.organisation_modules
  for insert to authenticated
  with check (public.is_super_admin());

drop policy if exists organisation_modules_update on public.organisation_modules;
create policy organisation_modules_update on public.organisation_modules
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  )
  with check (
    public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  );

drop policy if exists organisation_modules_delete on public.organisation_modules;
create policy organisation_modules_delete on public.organisation_modules
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- profile_module_overrides — restriction des modules PAR UTILISATEUR
-- ============================================================================
grant select, insert, update, delete on public.profile_module_overrides to authenticated;

drop policy if exists profile_module_overrides_select on public.profile_module_overrides;
create policy profile_module_overrides_select on public.profile_module_overrides
  for select to authenticated
  using (
    profile_id = auth.uid()
    or public.is_super_admin()
    or (public.is_org_admin() and public.profile_org_id(profile_id) = public.my_org_id())
  );

drop policy if exists profile_module_overrides_write on public.profile_module_overrides;
create policy profile_module_overrides_write on public.profile_module_overrides
  for all to authenticated
  using (
    public.is_super_admin()
    or (public.is_org_admin() and public.profile_org_id(profile_id) = public.my_org_id())
  )
  with check (
    public.is_super_admin()
    or (
      public.is_org_admin()
      and public.profile_org_id(profile_id) = public.my_org_id()
      -- Un admin ne peut pas autoriser un module que son organisation n'a pas.
      and (allowed = false or public.org_has_module(public.my_org_id(), module_key))
    )
  );

-- ============================================================================
-- membership_requests — la seule voie vers un rôle admin/editor
-- ============================================================================
grant select, insert, update, delete on public.membership_requests to authenticated;

drop policy if exists membership_requests_select on public.membership_requests;
create policy membership_requests_select on public.membership_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists membership_requests_insert on public.membership_requests;
create policy membership_requests_insert on public.membership_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and status = 'pending'
    and requested_role <> 'super_admin'
    and decided_role is null
    and decided_by is null
    and decided_at is null
    and decided_modules = '{}'::text[]
  );

drop policy if exists membership_requests_update on public.membership_requests;
create policy membership_requests_update on public.membership_requests
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Un demandeur peut retirer sa demande tant qu'elle est en attente.
drop policy if exists membership_requests_delete on public.membership_requests;
create policy membership_requests_delete on public.membership_requests
  for delete to authenticated
  using (
    public.is_super_admin()
    or (user_id = auth.uid() and status = 'pending')
  );

-- ============================================================================
-- surveys
-- Aucune policy pour `anon` : la lecture publique passe par la vue
-- public.public_surveys, qui n'expose que les colonnes nécessaires.
-- ============================================================================
grant select, insert, update, delete on public.surveys to authenticated;

drop policy if exists surveys_select on public.surveys;
create policy surveys_select on public.surveys
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_active_member() and organisation_id = public.my_org_id())
  );

drop policy if exists surveys_insert on public.surveys;
create policy surveys_insert on public.surveys
  for insert to authenticated
  with check (
    public.can_write_surveys()
    and organisation_id = public.my_org_id()
    and public.can_use_module(module_key)
  );

drop policy if exists surveys_update on public.surveys;
create policy surveys_update on public.surveys
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      public.can_write_surveys()
      and organisation_id = public.my_org_id()
      and public.can_use_module(module_key)
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.can_write_surveys()
      and organisation_id = public.my_org_id()
      and public.can_use_module(module_key)
    )
  );

drop policy if exists surveys_delete on public.surveys;
create policy surveys_delete on public.surveys
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      public.can_write_surveys()
      and organisation_id = public.my_org_id()
      and public.can_use_module(module_key)
    )
  );

-- ============================================================================
-- survey_responses
-- Aucune policy d'INSERT, pour personne : toute soumission passe par
-- public.submit_survey_response(), qui revérifie l'état du sondage.
-- Aucune policy de DELETE hors super_admin : la suppression courante est un
-- soft-delete (deleted_at), l'effacement définitif est un acte tracé.
-- ============================================================================
grant select, update on public.survey_responses to authenticated;
grant delete on public.survey_responses to authenticated;

drop policy if exists survey_responses_select on public.survey_responses;
create policy survey_responses_select on public.survey_responses
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.is_active_member()
      and organisation_id = public.my_org_id()
      -- La restriction de modules s'applique aussi aux ressources imbriquées.
      and public.can_use_module(public.survey_module_key(survey_id))
    )
  );

drop policy if exists survey_responses_update on public.survey_responses;
create policy survey_responses_update on public.survey_responses
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      public.can_write_surveys()
      and organisation_id = public.my_org_id()
      and public.can_use_module(public.survey_module_key(survey_id))
    )
  )
  with check (
    public.is_super_admin()
    or (
      public.can_write_surveys()
      and organisation_id = public.my_org_id()
      and public.can_use_module(public.survey_module_key(survey_id))
    )
  );

drop policy if exists survey_responses_delete on public.survey_responses;
create policy survey_responses_delete on public.survey_responses
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================================
-- audit_log — lecture seule ; l'écriture passe par public.write_audit()
-- ============================================================================
grant select on public.audit_log to authenticated;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  );

-- ============================================================================
-- erasure_requests — déposées via une fonction contrôlée, traitées par l'org
-- ============================================================================
grant select, update, delete on public.erasure_requests to authenticated;

drop policy if exists erasure_requests_select on public.erasure_requests;
create policy erasure_requests_select on public.erasure_requests
  for select to authenticated
  using (
    public.is_super_admin()
    or (
      public.can_write_surveys()
      and organisation_id = public.my_org_id()
    )
  );

drop policy if exists erasure_requests_update on public.erasure_requests;
create policy erasure_requests_update on public.erasure_requests
  for update to authenticated
  using (
    public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  )
  with check (
    public.is_super_admin()
    or (public.is_org_admin() and organisation_id = public.my_org_id())
  );

drop policy if exists erasure_requests_delete on public.erasure_requests;
create policy erasure_requests_delete on public.erasure_requests
  for delete to authenticated
  using (public.is_super_admin());
