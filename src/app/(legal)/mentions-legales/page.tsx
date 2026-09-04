import type { Metadata } from 'next';
import { LegalValue } from '@/components/legal/LegalValue';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { readPlatformSettings } from '@/lib/services/platform-settings';

export const metadata: Metadata = { title: fr.nav.legalNotice };

/**
 * Mentions légales, alimentées par `platform_settings` — jamais par des
 * valeurs en dur. Les champs non renseignés sont signalés comme tels.
 */
export default async function LegalNoticePage() {
  const context = await resolveRequestContext();
  const settings = await readPlatformSettings(context);

  return (
    <>
      <h1>{fr.nav.legalNotice}</h1>

      <h2>Éditeur du service</h2>
      <ul>
        <li>
          Dénomination : <LegalValue value={settings?.publisher_name} />
        </li>
        <li>
          Forme juridique : <LegalValue value={settings?.publisher_legal_form} />
        </li>
        <li>
          Immatriculation : <LegalValue value={settings?.publisher_registration} />
        </li>
        <li>
          Adresse : <LegalValue value={settings?.publisher_address} />
        </li>
        <li>
          Courriel : <LegalValue value={settings?.publisher_email} />
        </li>
        <li>
          Téléphone : <LegalValue value={settings?.publisher_phone} />
        </li>
        <li>
          Responsable de la publication : <LegalValue value={settings?.publisher_director} />
        </li>
      </ul>

      <h2>Hébergeur</h2>
      <ul>
        <li>
          Nom : <LegalValue value={settings?.host_name} />
        </li>
        <li>
          Adresse : <LegalValue value={settings?.host_address} />
        </li>
        <li>
          Site : <LegalValue value={settings?.host_url} />
        </li>
      </ul>

      <h2>Responsables des traitements</h2>
      <p>
        Chaque organisation utilisatrice de la plateforme est responsable du
        traitement des données qu’elle collecte au travers de ses propres
        formulaires : elle en définit la finalité, la base légale, la durée de
        conservation et les destinataires. L’éditeur du service agit comme
        sous-traitant pour le compte de ces organisations.
      </p>

      <h2>Protection des données</h2>
      <p>
        Les modalités de traitement des données personnelles, les droits des
        personnes concernées et les moyens de les exercer sont décrits dans la{' '}
        <a href="/confidentialite">politique de confidentialité</a>.
      </p>

      <h2>Propriété intellectuelle</h2>
      <p>
        Les contenus publiés par une organisation au travers de ses formulaires
        restent la propriété de celle-ci. Les éléments constitutifs du service
        appartiennent à son éditeur.
      </p>
    </>
  );
}
