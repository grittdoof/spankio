import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
import { canWriteSurveys, loadAdminSession } from '@/lib/admin/session';
import { resolveRequestContext } from '@/lib/data/context';
import { SURVEY_TEMPLATES } from '@/lib/event/templates';
import { fr } from '@/lib/i18n/fr';
import { createSurveyAction } from '../actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Nouveau formulaire' };

const ERRORS: Readonly<Record<string, string>> = {
  formulaire: 'Le titre doit contenir entre 2 et 200 caractères.',
  rattachement: 'Votre compte n’est rattaché à aucune organisation.',
  adresse:
    'Un formulaire porte déjà l’adresse publique dérivée de ce titre. Choisissez-en un autre.',
  creation: 'La création a été refusée.',
};

/**
 * Création d'un formulaire.
 *
 * Le type — sondage ou événement — est choisi ici et non après : il détermine
 * le module, donc les droits, et le changer ensuite reviendrait à déplacer un
 * formulaire d'un module à l'autre. Un modèle le fixe lui-même.
 *
 * Formulaire serveur classique : la création fonctionne sans JavaScript.
 */
export default async function NewSurveyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  if (!canWriteSurveys(session)) {
    return (
      <div className="sp-stack">
        <h1>Nouveau formulaire</h1>
        <Alert tone="error">
          Votre rôle ne permet pas de créer un formulaire. Demandez à un administrateur de
          votre organisation de vous accorder le rôle d’éditeur.
        </Alert>
        <p>
          <Link className="sp-btn sp-btn--outline sp-btn--sm" href="/admin/sondages">
            Retour aux formulaires
          </Link>
        </p>
      </div>
    );
  }

  // Un modèle dont le module n'est pas autorisé n'est pas proposé : le RLS le
  // refuserait à la création, autant ne pas le montrer.
  const allowed = new Set(
    session.modules.filter((module) => module.allowed).map((module) => module.key),
  );
  const templates = SURVEY_TEMPLATES.filter((template) => allowed.has(template.moduleKey));
  const eventAllowed = allowed.has('event');
  const errorCode = typeof params['erreur'] === 'string' ? params['erreur'] : undefined;

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      <div>
        <h1>Nouveau formulaire</h1>
        <p className="sp-muted">
          Les questions, les mentions d’information et la publication se règlent à l’étape
          suivante.
        </p>
      </div>

      {errorCode ? (
        <Alert tone="error">{ERRORS[errorCode] ?? fr.errors.unexpected}</Alert>
      ) : null}

      <form action={createSurveyAction} className="sp-card sp-stack">
        <Field id="title" label="Titre" required hint="Il sert aussi à composer l’adresse publique.">
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              maxLength={200}
              minLength={2}
              name="title"
              required
              type="text"
            />
          )}
        </Field>

        <Field id="kind" label="Type">
          {(attributes) => (
            <select {...attributes} className="sp-select" defaultValue="survey" name="kind">
              <option value="survey">{fr.admin.surveyKind.survey}</option>
              {eventAllowed ? (
                <option value="event">{fr.admin.surveyKind.event}</option>
              ) : null}
            </select>
          )}
        </Field>

        <Field
          id="templateKey"
          label="Modèle de départ"
          hint="Un modèle préremplit les questions ; elles restent modifiables. Le type du modèle l’emporte sur le choix ci-dessus."
        >
          {(attributes) => (
            <select {...attributes} className="sp-select" defaultValue="" name="templateKey">
              <option value="">Formulaire vierge</option>
              {templates.map((template) => (
                <option key={template.key} value={template.key}>
                  {template.name} — {template.description}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="sp-actions">
          <button className="sp-btn" type="submit">
            Créer
          </button>
          <Link className="sp-btn sp-btn--ghost" href="/admin/sondages">
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
