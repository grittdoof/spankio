import type { Metadata } from 'next';
import { LegalValue } from '@/components/legal/LegalValue';
import { resolveRequestContext } from '@/lib/data/context';
import { fr } from '@/lib/i18n/fr';
import { readPlatformSettings } from '@/lib/services/platform-settings';

export const metadata: Metadata = { title: fr.nav.privacy };

/**
 * Politique de confidentialité.
 *
 * RÈGLE D'OR : chaque affirmation de cette page doit correspondre exactement à
 * ce que le code collecte. Concrètement, et vérifié par la suite de tests :
 *   * `survey_responses` ne comporte AUCUNE colonne d'adresse IP, de
 *     user-agent ou d'identifiant de session ;
 *   * le seul cookie est celui de la session d'authentification ;
 *   * l'empreinte d'IP du limiteur de débit vit dans un store externe avec une
 *     durée de vie égale à la fenêtre, et n'entre jamais en base applicative.
 *
 * Le mot « anonyme » est volontairement absent : une réponse contient les
 * champs que l'organisation a décidé de collecter, parfois nominatifs.
 */
export default async function PrivacyPage() {
  const context = await resolveRequestContext();
  const settings = await readPlatformSettings(context);

  return (
    <>
      <h1>{fr.nav.privacy}</h1>

      <h2>Qui traite vos données</h2>
      <p>
        La plateforme héberge les formulaires de plusieurs organisations
        indépendantes. Pour un formulaire donné, le responsable du traitement est
        l’organisation qui l’a publié : c’est elle qui décide des données
        collectées, de la finalité poursuivie, de la base légale, de la durée de
        conservation et des destinataires. Ces informations sont rappelées sur
        l’écran de consentement du formulaire concerné.
      </p>
      <p>
        L’éditeur du service, <LegalValue value={settings?.publisher_name} />,
        intervient comme sous-traitant de ces organisations.
      </p>

      <h2>Quelles données sont enregistrées</h2>
      <p>
        Les données enregistrées lors d’une réponse sont{' '}
        <strong>exactement les champs du formulaire</strong> défini par
        l’organisation : selon les cas, une simple préférence, ou des données
        nominatives comme un nom, un courriel ou un numéro de téléphone. La
        plateforme n’ajoute aucune donnée de son propre chef.
      </p>
      <p>
        En particulier, <strong>aucune donnée technique de traçage n’est
        conservée</strong> : ni adresse IP, ni identifiant d’appareil ou de
        navigateur, ni identifiant de session n’est enregistré avec une réponse.
      </p>
      <p>
        Lorsque l’organisation active la prévention des doublons, la plateforme
        conserve une empreinte cryptographique (SHA-256) du champ désigné,
        propre à ce formulaire. Cette empreinte permet de refuser une seconde
        réponse et de retrouver les données d’une personne qui demande leur
        effacement, sans conserver une seconde copie en clair de la donnée et
        sans permettre de rapprochement entre deux formulaires.
      </p>
      <p>
        Lorsque le consentement est requis, la plateforme enregistre le fait que
        la case a été cochée <strong>et le texte exact affiché</strong> à ce
        moment-là, afin que la preuve du consentement reste vérifiable même si le
        formulaire est modifié ensuite.
      </p>

      <h2>Sécurité : limitation du débit</h2>
      <p>
        Pour empêcher les envois massifs automatisés, le service compte les
        requêtes par appelant. Ce compteur utilise une{' '}
        <strong>empreinte cryptographique de l’adresse IP</strong>, stockée dans
        un cache dédié dont la durée de vie n’excède pas la fenêtre de comptage
        (au plus une heure). L’adresse elle-même n’est jamais enregistrée, et
        cette empreinte n’est jamais associée à une réponse.
      </p>

      <h2>Cookies</h2>
      <p>
        Le service n’utilise <strong>aucun cookie de mesure d’audience ni de
        publicité</strong>. Le seul cookie déposé est le cookie technique de
        session, nécessaire à l’authentification des comptes d’administration.
        Répondre à un formulaire public n’en dépose aucun.
      </p>

      <h2>Durée de conservation</h2>
      <p>
        La durée est fixée par l’organisation pour chacun de ses formulaires et
        rappelée sur l’écran de consentement. À défaut d’indication contraire, la
        durée par défaut proposée par la plateforme est de{' '}
        <strong>{settings?.default_retention_days ?? 365} jours</strong>. À
        l’échéance, les réponses sont effacées définitivement par une tâche
        automatique.
      </p>

      <h2>Vos droits</h2>
      <p>
        Conformément au règlement général sur la protection des données, vous
        disposez d’un droit d’accès, de rectification, d’effacement, de
        limitation, d’opposition et de portabilité, ainsi que du droit de retirer
        votre consentement lorsque le traitement repose sur celui-ci.
      </p>
      <ul>
        <li>
          Auprès de l’organisation responsable du formulaire : ses coordonnées
          figurent sur la page du formulaire concerné.
        </li>
        <li>
          Auprès de l’éditeur du service :{' '}
          <LegalValue value={settings?.privacy_email ?? settings?.publisher_email} />
        </li>
        <li>
          Délégué à la protection des données :{' '}
          <LegalValue value={settings?.dpo_name} /> —{' '}
          <LegalValue value={settings?.dpo_email} />
        </li>
      </ul>
      <p>
        Une demande d’effacement peut être déposée directement depuis la page de
        confirmation d’un formulaire : elle est transmise à l’organisation
        concernée, qui l’exécute sur ses données.
      </p>

      <h2>Réclamation</h2>
      <p>
        Vous pouvez introduire une réclamation auprès de l’autorité de contrôle
        compétente : <LegalValue value={settings?.authority_name} />
        {settings?.authority_address ? <> — {settings.authority_address}</> : null}
        {settings?.authority_url ? (
          <>
            {' '}
            (<LegalValue value={settings.authority_url} />)
          </>
        ) : null}
        .
      </p>

      <h2>Hébergement et sous-traitants</h2>
      <div className="sp-table-wrapper">
        <table className="sp-table">
          <caption>
            Sous-traitants intervenant dans le fonctionnement du service.
          </caption>
          <thead>
            <tr>
              <th scope="col">Rôle</th>
              <th scope="col">Prestataire</th>
              <th scope="col">Localisation des données</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Hébergement de l’application</th>
              <td>
                <LegalValue value={settings?.host_name} />
              </td>
              <td>Union européenne</td>
            </tr>
            <tr>
              <th scope="row">Base de données, authentification, stockage</th>
              <td>Supabase</td>
              <td>Union européenne</td>
            </tr>
            <tr>
              <th scope="row">Envoi des courriels transactionnels</th>
              <td>Resend</td>
              <td>Union européenne</td>
            </tr>
            <tr>
              <th scope="row">Fonds de carte (module événement)</th>
              <td>OpenStreetMap</td>
              <td>Union européenne</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Les données sont chiffrées en transit (HTTPS) et au repos. L’accès aux
        données d’une organisation est cloisonné au niveau de la base de données
        elle-même : un compte rattaché à une organisation ne peut techniquement
        pas lire les données d’une autre.
      </p>
    </>
  );
}
