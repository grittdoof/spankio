-- ============================================================================
-- Adresse de notification de la plateforme.
--
-- Pourquoi une colonne plutôt qu'une énumération des super administrateurs :
-- notifier « les super_admin » obligerait l'application à lire leurs profils,
-- donc soit à exposer leurs adresses à n'importe quel compte authentifié, soit
-- à sortir la clé de service pour un simple email. Une adresse de destination,
-- réglée par le super administrateur, évite les deux.
-- ============================================================================

alter table public.platform_settings
  add column if not exists notifications_email text;

comment on column public.platform_settings.notifications_email is
  'Destinataire des notifications de plateforme (nouvelle demande de rattachement…). Réglé par le super administrateur.';
