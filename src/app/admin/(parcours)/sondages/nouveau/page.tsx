import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { WizardShell } from '@/components/admin/WizardShell';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { canWriteSurveys, loadAdminSession } from '@/lib/admin/session';
import {
  previousCreationUrl,
  resolveCreationStep,
  templatesFor,
  type DraftChoices,
} from '@/lib/admin/wizard';
import { resolveRequestContext } from '@/lib/data/context';
import { SURVEY_TEMPLATES } from '@/lib/event/templates';
import { fr } from '@/lib/i18n/fr';
import { chooseKind, chooseTemplate, createDraft } from './actions';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Nouveau formulaire' };

const ERRORS: Readonly<Record<string, string>> = {
  titre: 'Le titre doit contenir entre 2 et 200 caractères.',
  adresse:
    'Un formulaire porte déjà l’adresse publique dérivée de ce titre. Choisissez-en un autre.',
  rattachement: 'Votre compte n’est rattaché à aucune organisation.',
  creation: 'La création a été refusée.',
};

/** Champs cachés reportant les choix déjà faits : l'état vit dans l'URL. */
function Carried({ choices }: { choices: DraftChoices }) {
  return (
    <>
      <input name="kind" type="hidden" value={choices.kind} />
      <input name="templateKey" type="hidden" value={choices.templateKey ?? 'vierge'} />
    </>
  );
}

/**
 * Les trois premiers écrans du parcours : type, point de départ, titre.
 *
 * Une seule question par écran, et rien n'est écrit en base avant le
 * troisième. Trois écrans courts avant l'enregistrement, c'est peu de travail
 * à perdre si l'on abandonne ; au-delà, le brouillon serait créé plus tôt.
 */
export default async function NewSurveyWizardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string): string | undefined => {
    const value = params[key];
    return typeof value === 'string' ? value : undefined;
  };

  const context = await resolveRequestContext();
  if (!context.userId) redirect('/connexion');

  const session = await loadAdminSession(context, context.userId);
  if (!session) return <Alert tone="error">{fr.errors.unexpected}</Alert>;
  if (!session.attached) redirect('/admin');

  if (!canWriteSurveys(session)) {
    return (
      <main className="sp-wizard__body" id="contenu">
        <h1>Nouveau formulaire</h1>
        <Alert tone="error" title="Votre rôle ne permet pas de créer un formulaire">
          Demandez à un administrateur de votre organisation de vous accorder le rôle
          d’éditeur.
        </Alert>
      </main>
    );
  }

  const resolved = resolveCreationStep({
    etape: single('etape'),
    type: single('type'),
    modele: single('modele'),
  });
  if (!resolved.ok) redirect(resolved.redirectTo);

  const { step, choices } = resolved;
  const allowed = new Set(
    session.modules.filter((module) => module.allowed).map((module) => module.key),
  );
  const eventAllowed = allowed.has('event');
  const errorCode = single('erreur');
  const error = errorCode ? (ERRORS[errorCode] ?? fr.errors.unexpected) : null;

  // -------------------------------------------------------------------------
  if (step === 'type') {
    return (
      <form action={chooseKind}>
        <WizardShell
          step="type"
          question="Que souhaitez-vous créer ?"
          lead="Ce choix détermine ce que le formulaire pourra contenir. Il se fixe maintenant : un événement porte une date et un lieu, un sondage non."
          backHref={null}
          exitHref="/admin/sondages"
          footer={<SubmitButton pendingLabel="Un instant…">Continuer</SubmitButton>}
        >
          <ul className="sp-picks">
            <li>
              <label className="sp-pick">
                <input defaultChecked name="kind" type="radio" value="survey" />
                <span className="sp-pick__text">
                  <span className="sp-pick__name">Un sondage</span>
                  <span className="sp-pick__desc">
                    Pour recueillir des avis, recenser des besoins, mesurer une
                    satisfaction. Questions, étapes et conditions.
                  </span>
                </span>
              </label>
            </li>
            <li>
              <label className="sp-pick">
                <input disabled={!eventAllowed} name="kind" type="radio" value="event" />
                <span className="sp-pick__text">
                  <span className="sp-pick__name">Une inscription à un événement</span>
                  <span className="sp-pick__desc">
                    Tout ce qu’un sondage permet, plus une date, un lieu sur une carte,
                    une bannière, l’ajout à l’agenda et un itinéraire pour les
                    répondants.
                    {!eventAllowed
                      ? ' Le module événement n’est pas activé pour votre organisation.'
                      : ''}
                  </span>
                </span>
              </label>
            </li>
          </ul>
        </WizardShell>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  if (step === 'modele') {
    const templates = templatesFor(SURVEY_TEMPLATES, choices.kind, allowed);

    return (
      <form action={chooseTemplate}>
        <input name="kind" type="hidden" value={choices.kind} />
        <WizardShell
          step="modele"
          question="Partir de zéro, ou d’un modèle ?"
          lead="Un modèle préremplit les questions les plus courantes. Tout reste modifiable ensuite : rien n’est figé par ce choix."
          backHref={previousCreationUrl('modele', choices, null)}
          exitHref="/admin/sondages"
          footer={<SubmitButton pendingLabel="Un instant…">Continuer</SubmitButton>}
        >
          <ul className="sp-picks">
            <li>
              <label className="sp-pick">
                <input defaultChecked name="templateKey" type="radio" value="vierge" />
                <span className="sp-pick__text">
                  <span className="sp-pick__name">Formulaire vierge</span>
                  <span className="sp-pick__desc">
                    Vous composez toutes les questions vous-même.
                  </span>
                </span>
              </label>
            </li>
            {templates.map((template) => (
              <li key={template.key}>
                <label className="sp-pick">
                  <input name="templateKey" type="radio" value={template.key} />
                  <span className="sp-pick__text">
                    <span className="sp-pick__name">{template.name}</span>
                    <span className="sp-pick__desc">{template.description}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </WizardShell>
      </form>
    );
  }

  // -------------------------------------------------------------------------
  return (
    <form action={createDraft}>
      <Carried choices={choices} />
      <WizardShell
        step="titre"
        question="Comment s’appelle ce formulaire ?"
        lead="Le titre s’affiche aux répondants et sert à composer son adresse publique. Vous pourrez le changer à tout moment."
        backHref={previousCreationUrl('titre', choices, null)}
        exitHref="/admin/sondages"
        footer={<SubmitButton pendingLabel="Création…">Créer le formulaire</SubmitButton>}
      >
        {error ? <Alert tone="error">{error}</Alert> : null}

        <Field id="title" label="Titre du formulaire" required>
          {(attributes) => (
            <input
              {...attributes}
              autoFocus
              className="sp-input"
              maxLength={200}
              minLength={2}
              name="title"
              required
              type="text"
            />
          )}
        </Field>

        <Callout title="Ce qui se passe ensuite">
          Le formulaire est créé en brouillon : il n’accepte aucune réponse tant que vous
          ne l’avez pas publié. L’écran suivant demande les informations à afficher aux
          répondants.
          <Example>
            « Assemblée générale 2027 » donne l’adresse …/assemblee-generale-2027
          </Example>
        </Callout>
      </WizardShell>
    </form>
  );
}
