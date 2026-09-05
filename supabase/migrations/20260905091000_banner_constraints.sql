-- ============================================================================
-- Contraintes du bucket des bannières.
--
-- Le téléversement se fait DIRECTEMENT du navigateur vers Storage, avec la
-- session de l'utilisateur : les octets ne transitent pas par une route Next,
-- qui plafonne le corps des requêtes et facturerait la bande passante deux
-- fois. Conséquence : les seuls contrôles qui comptent sont ceux que Storage
-- applique lui-même — une validation faite dans le navigateur ne protège de
-- rien.
--
-- On les pose donc ici :
--   * `file_size_limit`   : 3 Mio, largement au-dessus d'une bannière de page
--                           mais loin d'un dépôt de fichiers déguisé ;
--   * `allowed_mime_types`: images matricielles usuelles UNIQUEMENT. Pas de
--                           SVG : un SVG est un document XML qui peut porter
--                           du script, et il est servi depuis un bucket
--                           public — donc depuis une origine que le navigateur
--                           traiterait comme un document.
--
-- Le RLS des objets (dossier = organisation, module `event` requis) reste
-- défini par les migrations précédentes ; rien n'est redéfini ici.
--
-- Migration tolérante : sous PGlite (tests), le schéma `storage` n'existe pas.
-- ============================================================================

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'Schéma storage absent : contraintes du bucket non posées (environnement de test).';
    return;
  end if;

  update storage.buckets
  set
    file_size_limit = 3145728,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
  where id = 'survey-banners';
end
$$;
