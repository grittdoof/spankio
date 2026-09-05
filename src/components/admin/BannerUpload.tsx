'use client';

import { useId, useState } from 'react';
import { Field } from '@/components/ui/Field';
import { publicEnv } from '@/lib/config/env';
import {
  BANNER_ASPECT_LABEL,
  BANNER_MAX_BYTES,
  BANNER_MIME_TYPES,
  bannerNonce,
  bannerPath,
  bannerPublicUrl,
  checkBanner,
} from '@/lib/event/banner';
import { BannerFrame } from '@/components/ui/BannerFrame';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';

/**
 * Téléversement de la bannière.
 *
 * L'image part DIRECTEMENT du navigateur vers Storage, avec la session de
 * l'utilisateur : les octets ne traversent pas une route Next, qui plafonne le
 * corps des requêtes et ferait payer la bande passante deux fois. Le RLS de
 * Storage impose le dossier de l'organisation, et le bucket impose le type et
 * la taille — ce sont les contrôles qui comptent.
 *
 * Les vérifications faites ici ne protègent de rien : elles évitent d'envoyer
 * trois mégaoctets pour recevoir une erreur illisible. Le chemin enregistré est
 * revérifié par le serveur (`isBannerPathOf`), qui n'a aucune raison de croire
 * ce que le navigateur lui envoie.
 */

export interface BannerUploadProps {
  organisationId: string;
  surveyId: string;
  /** Chemin actuel dans le bucket, ou `null`. */
  value: string | null;
  onChange: (path: string | null) => void;
}

const MAX_MIB = Math.round(BANNER_MAX_BYTES / (1024 * 1024));

export function BannerUpload({
  organisationId,
  surveyId,
  value,
  onChange,
}: BannerUploadProps) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // L'aperçu est dérivé du chemin courant, pas d'une URL reçue en propriété :
  // sinon l'image tout juste téléversée ne s'afficherait qu'après un
  // rechargement, et l'écran laisserait croire que rien ne s'est passé.
  const previewUrl = value
    ? bannerPublicUrl(publicEnv().NEXT_PUBLIC_SUPABASE_URL, value)
    : null;

  const upload = async (file: File) => {
    setError(null);
    setNotice(null);

    const check = checkBanner(file);
    if (!check.ok) {
      setError(check.reason.message);
      return;
    }

    const path = bannerPath(organisationId, surveyId, file.type, new Date(), bannerNonce());
    if (!path) {
      setError('Impossible de composer le chemin de l’image.');
      return;
    }

    setBusy(true);
    const client = createSupabaseBrowserClient();
    const { error: uploadError } = await client.storage
      .from('survey-banners')
      // `upsert: false` : chaque version a son propre chemin. Écraser un objet
      // laisserait les caches servir l'ancienne image pendant des heures.
      .upload(path, file, { contentType: file.type, upsert: false });
    setBusy(false);

    if (uploadError) {
      setError(
        'Le téléversement a été refusé. Vérifiez le format et la taille, ou vos droits sur le module événement.',
      );
      return;
    }

    onChange(path);
    setNotice('Image téléversée. Enregistrez pour l’appliquer au formulaire.');
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '0.75rem' } as React.CSSProperties}>
      {previewUrl ? <BannerFrame url={previewUrl} variant="preview" /> : null}

      <div className="sp-file-field">
        <Field
          id={`${id}-fichier`}
          label="Bannière de l’événement"
          hint={`JPEG, PNG, WebP ou AVIF, ${MAX_MIB} Mio au maximum. Format conseillé : ${BANNER_ASPECT_LABEL} — une image à ce format s’affiche entière, une autre est recadrée au centre.`}
          error={error}
        >
          {(attributes) => (
            <input
              {...attributes}
              accept={BANNER_MIME_TYPES.join(',')}
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

      <div aria-live="polite">
        {busy ? <p className="sp-muted">Téléversement en cours…</p> : null}
        {notice ? <p className="sp-muted">{notice}</p> : null}
      </div>

      {value ? (
        <p>
          <button
            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
            type="button"
            onClick={() => {
              // Le fichier reste dans le bucket : le retirer du formulaire est
              // une décision d'affichage, pas un effacement. La purge des
              // objets orphelins relève de la conservation.
              onChange(null);
              setNotice('Bannière retirée. Enregistrez pour l’appliquer.');
            }}
          >
            Retirer la bannière
          </button>
        </p>
      ) : null}
    </div>
  );
}
