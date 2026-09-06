'use client';

import { useId, useState } from 'react';
import { Field } from '@/components/ui/Field';
import { publicEnv } from '@/lib/config/env';
import {
  LOGO_BUCKET,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  checkLogo,
  isStoredLogoUrl,
  logoNonce,
  logoPath,
  logoPublicUrl,
} from '@/lib/organisation/logo';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/**
 * Logo de l'organisation : un fichier à déposer, ou un lien.
 *
 * Les deux chemins coexistent parce que les organisations ne sont pas dans la
 * même situation : la plupart ont leur logo dans un fichier, quelques-unes
 * l'ont déjà en ligne sur leur site. N'offrir que le lien obligerait à
 * chercher où héberger l'image ; n'offrir que le dépôt obligerait à dupliquer
 * une image déjà publiée.
 *
 * Le fichier part DIRECTEMENT du navigateur vers Storage, avec la session de
 * l'utilisateur : les octets ne traversent pas une route Next, qui plafonne le
 * corps des requêtes. Les contrôles qui protègent sont ceux du bucket (1 Mio,
 * quatre types d'image, pas de SVG) et le RLS des objets ; ce qui est vérifié
 * ici ne fait qu'éviter un envoi voué à l'échec. L'URL retenue est revérifiée
 * côté serveur (`isLogoUrlOf`).
 *
 * La valeur finale voyage dans un champ caché : le formulaire reste un
 * `<form action={serverAction}>` ordinaire, et l'enregistrement du profil ne
 * dépend pas de ce composant.
 */

export interface LogoUploadProps {
  organisationId: string;
  /** URL actuelle, téléversée ou externe. */
  value: string | null;
  error?: string | undefined;
}

const MAX_KIB = Math.round(LOGO_MAX_BYTES / 1024);

export function LogoUpload({ organisationId, value, error }: LogoUploadProps) {
  const id = useId();
  const supabaseUrl = publicEnv().NEXT_PUBLIC_SUPABASE_URL;

  const [url, setUrl] = useState<string>(value ?? '');
  const [mode, setMode] = useState<'file' | 'link'>(
    value && !isStoredLogoUrl(value, supabaseUrl) ? 'link' : 'file',
  );
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upload = async (file: File) => {
    setFailure(null);
    setNotice(null);

    const check = checkLogo(file);
    if (!check.ok) {
      setFailure(check.reason.message);
      return;
    }

    const path = logoPath(organisationId, file.type, new Date(), logoNonce());
    if (!path) {
      setFailure('Impossible de composer le chemin de l’image.');
      return;
    }

    setBusy(true);
    const client = createSupabaseBrowserClient();
    const { error: uploadError } = await client.storage
      .from(LOGO_BUCKET)
      // `upsert: false` : chaque version a son propre chemin. Écraser un objet
      // laisserait les caches servir l'ancienne image pendant des heures.
      .upload(path, file, { contentType: file.type, upsert: false });
    setBusy(false);

    if (uploadError) {
      setFailure(
        'Le dépôt a été refusé. Vérifiez le format et la taille — et que vous êtes bien administrateur de l’organisation.',
      );
      return;
    }

    setUrl(logoPublicUrl(supabaseUrl, path));
    setNotice('Logo déposé. Enregistrez le profil pour l’appliquer.');
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-4)' } as React.CSSProperties}>
      {/* La valeur enregistrée, quel que soit le chemin emprunté. */}
      <input name="logoUrl" type="hidden" value={url} />

      {url ? (
        <div className="sp-logo-preview">
          {/* Décoratif : le nom de l'organisation est juste au-dessus, dans le
              champ « Nom ». Le décrire ici le ferait entendre deux fois.
              eslint-disable-next-line @next/next/no-img-element */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt="" src={url} />
          <div>
            <p className="sp-muted">
              {isStoredLogoUrl(url, supabaseUrl)
                ? 'Logo hébergé par la plateforme.'
                : 'Logo chargé depuis un site externe.'}
            </p>
            <button
              className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
              type="button"
              onClick={() => {
                // Le fichier reste dans le bucket : le retirer du profil est
                // une décision d'affichage, pas un effacement.
                setUrl('');
                setNotice('Logo retiré. Enregistrez le profil pour l’appliquer.');
              }}
            >
              Retirer le logo
            </button>
          </div>
        </div>
      ) : null}

      <fieldset className="sp-fieldset">
        <legend>Comment fournir le logo ?</legend>
        <ul className="sp-picks">
          <li>
            <label className="sp-pick">
              <input
                checked={mode === 'file'}
                name={`${id}-mode`}
                onChange={() => setMode('file')}
                type="radio"
                value="file"
              />
              <span className="sp-pick__text">
                <span className="sp-pick__name">Déposer un fichier</span>
                <span className="sp-pick__desc">
                  L’image est hébergée par la plateforme, à côté de vos formulaires.
                </span>
              </span>
            </label>
          </li>
          <li>
            <label className="sp-pick">
              <input
                checked={mode === 'link'}
                name={`${id}-mode`}
                onChange={() => setMode('link')}
                type="radio"
                value="link"
              />
              <span className="sp-pick__text">
                <span className="sp-pick__name">Indiquer un lien</span>
                <span className="sp-pick__desc">
                  Si votre logo est déjà en ligne. À savoir : le site qui l’héberge verra
                  passer l’adresse IP de chaque répondant qui ouvre vos formulaires.
                </span>
              </span>
            </label>
          </li>
        </ul>
      </fieldset>

      {mode === 'file' ? (
        <div className="sp-file-field">
          <Field
            id={`${id}-fichier`}
            label="Fichier du logo"
            error={failure ?? error}
            hint={`PNG, JPEG, WebP ou AVIF, ${MAX_KIB} Kio au maximum. Le SVG n’est pas accepté : c’est un document qui peut contenir du code.`}
          >
            {(attributes) => (
              <input
                {...attributes}
                accept={LOGO_MIME_TYPES.join(',')}
                disabled={busy}
                type="file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  // Le champ est vidé : sans cela, re-sélectionner le même
                  // fichier après une erreur ne déclencherait aucun événement.
                  event.target.value = '';
                }}
              />
            )}
          </Field>
        </div>
      ) : (
        <Field
          id={`${id}-lien`}
          label="Adresse de l’image"
          error={failure ?? error}
          hint="Adresse complète, commençant par https://"
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              inputMode="url"
              maxLength={500}
              onChange={(event) => {
                setUrl(event.target.value.trim());
                setNotice(null);
              }}
              placeholder="https://"
              type="url"
              value={isStoredLogoUrl(url, supabaseUrl) ? '' : url}
            />
          )}
        </Field>
      )}

      <div aria-live="polite">
        {busy ? <p className="sp-muted">Dépôt en cours…</p> : null}
        {notice ? <p className="sp-muted">{notice}</p> : null}
      </div>
    </div>
  );
}
