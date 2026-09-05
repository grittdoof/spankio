'use client';

import { useCallback, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Callout, Example } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { Steps } from '@/components/ui/Steps';
import { Tooltip } from '@/components/ui/Tooltip';
import {
  FIELD_TYPE_LABELS,
  canAddField,
  conditionCandidates,
  defaultField,
  defaultStep,
  moveItem,
  removeField,
  removeStep,
  usedIdentifiers,
} from '@/lib/survey/builder';
import { LEGAL_BASES } from '@/lib/services/surveys';
import { LEGAL_BASIS_GUIDE, type LegalBasis } from '@/lib/survey/consent';
import {
  EDITOR_STEPS,
  EDITOR_TOTAL,
  checkEditorStep,
  editorStep,
  editorStepNumber,
  nextEditorStep,
  previousEditorStep,
  stepForRequirement,
  type EditorStepKey,
} from '@/lib/survey/editor-steps';
import { missingForPublication } from '@/lib/survey/publication';
import { FIELD_TYPES, type FieldType, type SurveySchema } from '@/lib/survey/schema';
import type { SurveySettings } from '@/lib/survey/settings';
import { FieldEditor } from './FieldEditor';

/**
 * Éditeur visuel du schéma.
 *
 * Trois partis pris :
 *
 *  1. **Pas de glisser-déposer.** Réordonner se fait par des boutons « monter »
 *     et « descendre ». Un glisser-déposer sans équivalent clavier serait
 *     inutilisable au clavier et par lecteur d'écran ; en construire un
 *     accessible dépasse largement le gain.
 *  2. **Les opérations de structure sont pures** (`src/lib/survey/builder.ts`)
 *     et testées à part : supprimer une question nettoie les conditions qui la
 *     référençaient, sinon le schéma deviendrait invalide au moment
 *     d'enregistrer, après le travail de l'utilisateur.
 *  3. **La validité est annoncée en continu**, avec le même validateur que le
 *     serveur : on ne découvre pas au moment de publier que le formulaire est
 *     refusé.
 */

export interface SurveyDraft {
  title: string;
  slug: string;
  description: string | null;
  status: 'draft' | 'published' | 'closed';
  schema: SurveySchema;
  settings: SurveySettings;
  purpose: string | null;
  legalBasis: string | null;
  retentionDays: number | null;
  recipients: string | null;
  requireConsent: boolean;
  dedupField: string | null;
}

export interface SurveyBuilderProps {
  surveyId: string;
  initial: SurveyDraft;
  publicUrl: string;
  /**
   * Date de l'événement, `undefined` pour un sondage. L'éditeur ne la modifie
   * pas — elle se règle sur son propre écran — mais il doit la connaître pour
   * dire ce qui manque avant de publier.
   */
  eventStartsAt?: string | null;
  onSave: (draft: SurveyDraft) => Promise<{ ok: true } | { ok: false; fields?: Record<string, string>; message?: string }>;
}

export function SurveyBuilder({
  surveyId,
  initial,
  publicUrl,
  eventStartsAt,
  onSave,
}: SurveyBuilderProps) {
  const [draft, setDraft] = useState<SurveyDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  /**
   * Messages à ÉNUMÉRER dans l'alerte, distincts des erreurs de champ.
   *
   * Un refus du serveur peut porter sur une étape qu'on ne regarde pas : il
   * faut alors l'énumérer. Un blocage d'étape, lui, signale ses champs à
   * l'écran — les répéter dans l'alerte ferait lire deux fois la même phrase.
   */
  const [listErrors, setListErrors] = useState<readonly string[]>([]);
  const [currentStep, setCurrentStep] = useState<EditorStepKey>('identite');

  const previous = previousEditorStep(currentStep);
  const next = nextEditorStep(currentStep);

  /**
   * Va à une étape, en remontant en haut de l'écran.
   *
   * Sans ce défilement, changer d'étape laisserait la page au milieu du
   * contenu précédent : l'utilisateur verrait la barre du bas changer et
   * croirait que rien d'autre n'a bougé.
   */
  const goTo = useCallback((target: EditorStepKey) => {
    setCurrentStep(target);
    setErrors({});
    setListErrors([]);
    setNotice(null);
    if (typeof window?.scrollTo === 'function') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);

  /**
   * Quitte l'étape courante pour une autre.
   *
   * Règle : on ne QUITTE pas une étape dont un champ obligatoire est mal
   * rempli — mais revenir en arrière est toujours libre, et on peut sauter à
   * n'importe quelle étape suivante dès lors que celle qu'on quitte est
   * valide. Sans cette liberté, l'écran de publication resterait
   * inatteignable tant qu'une mention manque, et sa liste des manques ne
   * servirait à rien.
   *
   * En cas de refus, on ne se contente PAS d'afficher un message : le champ
   * fautif reçoit le focus et est ramené dans la vue. « Certains champs sont
   * invalides » sur un écran qui en compte six laisse chercher lequel.
   */
  const leaveFor = useCallback(
    (target: EditorStepKey) => {
      const goingBack = editorStepNumber(target) < editorStepNumber(currentStep);
      if (goingBack) {
        goTo(target);
        return;
      }

      const check = checkEditorStep(currentStep, {
        title: draft.title,
        slug: draft.slug,
        purpose: draft.purpose,
        legalBasis: draft.legalBasis,
        retentionDays: draft.retentionDays,
      });

      if (!check.ok) {
        setErrors(check.block.errors);
        setListErrors([]);
        setNotice('Complétez les champs signalés pour continuer.');
        if (typeof document !== 'undefined') {
          const field = document.getElementById(check.block.firstField);
          // `scrollIntoView` est testé avant d'être appelé : tous les moteurs
          // ne l'implémentent pas, et une exception ici empêcherait le focus
          // — c'est-à-dire la seule partie qui compte vraiment.
          if (typeof field?.scrollIntoView === 'function') {
            field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          // `focus` APRÈS le défilement, avec `preventScroll` : sans cela deux
          // défilements se disputeraient la page et le champ finirait sous la
          // barre du bas.
          field?.focus({ preventScroll: true });
        }
        return;
      }

      goTo(target);
    },
    [currentStep, draft, goTo],
  );

  const goNext = useCallback(() => {
    if (next) leaveFor(next);
  }, [leaveFor, next]);

  /** L'annonce est une erreur dès qu'un champ est en défaut, sinon un succès. */
  const tone = Object.keys(errors).length > 0 ? 'error' : 'success';

  const schema = draft.schema;
  const used = useMemo(() => usedIdentifiers(schema), [schema]);

  /**
   * Ce qui manque pour publier, recalculé à chaque frappe avec la MÊME
   * fonction que le serveur. On ne découvre donc pas au moment de publier
   * qu'il manquait une mention — et l'écran ne peut pas annoncer « prêt »
   * sur un formulaire que le serveur refusera.
   */
  const missing = useMemo(
    () =>
      missingForPublication({
        kind: eventStartsAt === undefined ? 'survey' : 'event',
        schema,
        purpose: draft.purpose,
        legalBasis: draft.legalBasis,
        retentionDays: draft.retentionDays,
        eventStartsAt: eventStartsAt ?? null,
      }),
    [schema, draft.purpose, draft.legalBasis, draft.retentionDays, eventStartsAt],
  );

  const setSchema = useCallback((next: SurveySchema) => {
    setDraft((previous) => ({ ...previous, schema: next }));
    setNotice(null);
  }, []);

  const addStep = () => setSchema({ ...schema, steps: [...schema.steps, defaultStep(used)] });

  const addField = (stepIndex: number, type: FieldType) => {
    setSchema({
      ...schema,
      steps: schema.steps.map((step, index) =>
        index === stepIndex ? { ...step, fields: [...step.fields, defaultField(type, used)] } : step,
      ),
    });
  };

  const save = async () => {
    setSaving(true);
    setErrors({});
    setListErrors([]);
    setNotice(null);

    const result = await onSave(draft);
    setSaving(false);

    if (result.ok) {
      setNotice('Enregistré.');
      return;
    }
    setErrors(result.fields ?? {});
    setListErrors(Object.values(result.fields ?? {}));
    setNotice(result.message ?? 'L’enregistrement a échoué.');
  };

  const publish = async () => {
    const next = { ...draft, status: 'published' as const };
    setDraft(next);
    setSaving(true);
    setErrors({});
    setListErrors([]);

    const result = await onSave(next);
    setSaving(false);

    if (result.ok) {
      setNotice('Formulaire publié.');
      return;
    }
    // La publication a échoué : on ne laisse pas l'écran prétendre le
    // contraire, l'état revient à ce qu'il était.
    setDraft((previous) => ({ ...previous, status: draft.status }));
    setErrors(result.fields ?? {});
    setListErrors(Object.values(result.fields ?? {}));
    setNotice(result.message ?? 'Publication impossible.');
  };

  return (
    <div className="sp-builder sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      {/* UNE seule zone d'annonce. Deux `role="alert"` simultanés
          interrompraient deux fois le lecteur d'écran pour un même événement,
          et la seconde interruption écraserait souvent la première.

          La LISTE des messages n'apparaît que si les champs concernés ne sont
          pas déjà signalés sous les yeux de l'utilisateur — c'est le cas d'un
          refus du serveur, qui peut porter sur une autre étape. Répéter dans
          l'alerte ce qui est écrit trois centimètres plus bas ferait lire deux
          fois la même phrase. */}
      {tone === 'error' ? (
        <Alert tone="error" title={notice ?? 'À corriger avant de continuer'}>
          {listErrors.length > 0 ? (
            <ul>
              {listErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : notice ? (
        <Alert tone="success">{notice}</Alert>
      ) : null}

      <nav aria-label="Étapes du formulaire">
        <ol className="sp-editor-steps">
          {EDITOR_STEPS.map((entry) => {
            const isCurrent = entry.key === currentStep;
            return (
              <li key={entry.key}>
                <button
                  className="sp-editor-step"
                  type="button"
                  onClick={() => leaveFor(entry.key)}
                  {...(isCurrent ? { 'aria-current': 'step' as const } : {})}
                >
                  <span aria-hidden="true" className="sp-editor-step__num">
                    {editorStepNumber(entry.key)}
                  </span>
                  {entry.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div>
        <h2 className="sp-ask__title">{editorStep(currentStep).question}</h2>
        <p className="sp-ask__lead">{editorStep(currentStep).lead}</p>
      </div>

      {currentStep === 'identite' ? (
        <>
        <section className="sp-section sp-stack">
          <div>
            <h2 className="sp-section__title">
              Identité du formulaire{' '}
              <Tooltip label="identité du formulaire">
                Le titre et la description s’affichent sur l’écran d’accueil vu par les
                répondants. L’adresse publique, elle, ne change pas d’elle-même : la
                modifier casse les liens déjà partagés.
              </Tooltip>
            </h2>
          </div>

          <Field id="titre" label="Titre" error={errors['titre']} required>
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="text"
                value={draft.title}
                maxLength={200}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            )}
          </Field>

          <Field
            id="slug"
            label="Adresse publique"
            error={errors['slug']}
            hint={`${publicUrl} — la modifier rend inopérants les liens déjà partagés.`}
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="text"
                value={draft.slug}
                maxLength={82}
                spellCheck={false}
                onChange={(event) => setDraft({ ...draft, slug: event.target.value })}
              />
            )}
          </Field>

          <Field id="description" label="Description affichée à l’accueil">
            {(attributes) => (
              <textarea
                {...attributes}
                className="sp-textarea"
                rows={3}
                value={draft.description ?? ''}
                maxLength={4000}
                onChange={(event) =>
                  setDraft({ ...draft, description: event.target.value || null })
                }
              />
            )}
          </Field>
        </section>
        </>
      ) : null}

      {currentStep === 'questions' ? (
        <>
        <section className="sp-section sp-stack">
          <div>
            <h2 className="sp-section__title">Questions</h2>
            <p className="sp-section__lead">
              Les répondants voient une question par écran. Les étapes regroupent des
              questions qui vont ensemble, et chacune peut n’apparaître que si une
              réponse précédente le justifie.
            </p>
          </div>

          {schema.steps.length === 0 ? (
            <div className="sp-empty">
              <h3 className="sp-empty__title">Aucune question pour l’instant</h3>
              <p className="sp-empty__lead">
                Ajoutez une première étape : elle arrive avec une question, que vous
                n’aurez plus qu’à reformuler.
              </p>
              <button className="sp-btn sp-btn--lg" type="button" onClick={addStep}>
                Ajouter une première étape
              </button>
            </div>
          ) : null}

          {schema.steps.map((step, stepIndex) => (
            <section className="sp-card sp-stack" key={step.id}>
              <div className="sp-card__header">
                <h3 className="sp-card__title">Étape {stepIndex + 1}</h3>
                <div className="sp-actions">
                  <button
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    type="button"
                    disabled={stepIndex === 0}
                    onClick={() =>
                      setSchema({ ...schema, steps: moveItem(schema.steps, stepIndex, stepIndex - 1) })
                    }
                  >
                    Monter l’étape
                  </button>
                  <button
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    type="button"
                    disabled={stepIndex === schema.steps.length - 1}
                    onClick={() =>
                      setSchema({ ...schema, steps: moveItem(schema.steps, stepIndex, stepIndex + 1) })
                    }
                  >
                    Descendre l’étape
                  </button>
                  <button
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    type="button"
                    onClick={() => setSchema(removeStep(schema, step.id))}
                  >
                    Supprimer l’étape
                  </button>
                </div>
              </div>

              <Field id={`${step.id}-titre`} label="Titre de l’étape">
                {(attributes) => (
                  <input
                    {...attributes}
                    className="sp-input"
                    type="text"
                    value={step.title ?? ''}
                    maxLength={200}
                    onChange={(event) =>
                      setSchema({
                        ...schema,
                        steps: schema.steps.map((candidate, index) =>
                          index === stepIndex
                            ? { ...candidate, title: event.target.value || undefined }
                            : candidate,
                        ),
                      })
                    }
                  />
                )}
              </Field>

              <Field id={`${step.id}-intro`} label="Texte d’introduction de l’étape">
                {(attributes) => (
                  <textarea
                    {...attributes}
                    className="sp-textarea"
                    rows={2}
                    value={step.intro ?? ''}
                    maxLength={2000}
                    onChange={(event) =>
                      setSchema({
                        ...schema,
                        steps: schema.steps.map((candidate, index) =>
                          index === stepIndex
                            ? { ...candidate, intro: event.target.value || undefined }
                            : candidate,
                        ),
                      })
                    }
                  />
                )}
              </Field>

              <label className="sp-choice">
                <input
                  type="checkbox"
                  checked={step.hideIntro}
                  onChange={(event) =>
                    setSchema({
                      ...schema,
                      steps: schema.steps.map((candidate, index) =>
                        index === stepIndex
                          ? { ...candidate, hideIntro: event.target.checked }
                          : candidate,
                      ),
                    })
                  }
                />
                <span className="sp-choice__label">
                  Passer l’écran d’introduction
                  <span className="sp-choice__desc">
                    L’étape enchaîne directement sur sa première question.
                  </span>
                </span>
              </label>

              <ul className="sp-list">
                {step.fields.map((field, fieldIndex) => (
                  <FieldEditor
                    key={field.id}
                    field={field}
                    index={fieldIndex}
                    count={step.fields.length}
                    conditionCandidates={conditionCandidates(schema, field.id)}
                    onChange={(next) =>
                      setSchema({
                        ...schema,
                        steps: schema.steps.map((candidate, index) =>
                          index === stepIndex
                            ? {
                                ...candidate,
                                fields: candidate.fields.map((entry) =>
                                  entry.id === field.id ? next : entry,
                                ),
                              }
                            : candidate,
                        ),
                      })
                    }
                    onMove={(direction) =>
                      setSchema({
                        ...schema,
                        steps: schema.steps.map((candidate, index) =>
                          index === stepIndex
                            ? {
                                ...candidate,
                                fields: moveItem(
                                  candidate.fields,
                                  fieldIndex,
                                  fieldIndex + direction,
                                ),
                              }
                            : candidate,
                        ),
                      })
                    }
                    onRemove={() => setSchema(removeField(schema, field.id))}
                  />
                ))}
              </ul>

              <AddFieldControl
                stepId={step.id}
                disabled={!canAddField(schema)}
                onAdd={(type) => addField(stepIndex, type)}
              />
            </section>
          ))}

          <p>
            <button className="sp-btn sp-btn--outline" type="button" onClick={addStep}>
              Ajouter une étape
            </button>
          </p>
        </section>
        </>
      ) : null}

      {currentStep === 'informations' ? (
        <>
        <section className="sp-section sp-stack">
          <div>
            <h2 className="sp-section__title">Informations aux répondants</h2>
            <p className="sp-section__lead">
              Ces mentions sont affichées avant l’envoi, puis conservées avec chaque réponse
              comme preuve de ce qui a été annoncé. Elles sont obligatoires pour publier.
            </p>
          </div>

          <Field
            id="purpose"
            label="À quoi servent les réponses ?"
            error={errors['purpose']}
            hint="Une phrase, dans les mots de votre organisation. C’est la « finalité » au sens du RGPD."
            required
          >
            {(attributes) => (
              <textarea
                {...attributes}
                className="sp-textarea"
                rows={2}
                value={draft.purpose ?? ''}
                maxLength={2000}
                onChange={(event) => setDraft({ ...draft, purpose: event.target.value || null })}
              />
            )}
          </Field>

          <Callout tone="muted">
            <Example>
              Organiser l’assemblée générale : compter les présents et prévoir les repas.
            </Example>
          </Callout>

          <Field
            id="legalBasis"
            label="Base légale"
            error={errors['legalBasis']}
            hint={
              draft.legalBasis
                ? LEGAL_BASIS_GUIDE[draft.legalBasis as LegalBasis]?.when
                : 'Le RGPD prévoit six fondements possibles ; la plateforme n’en impose aucun.'
            }
            required
          >
            {(attributes) => (
              <select
                {...attributes}
                className="sp-select"
                value={draft.legalBasis ?? ''}
                onChange={(event) => setDraft({ ...draft, legalBasis: event.target.value || null })}
              >
                <option value="">À choisir…</option>
                {LEGAL_BASES.map((basis) => (
                  <option key={basis} value={basis}>
                    {LEGAL_BASIS_GUIDE[basis].choice}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            id="retentionDays"
            label="Durée de conservation (en jours)"
            error={errors['retentionDays']}
            hint="Au terme de ce délai, les réponses sont effacées automatiquement par une purge quotidienne. Ce n’est pas une intention affichée."
            required
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="number"
                min={1}
                max={3650}
                value={draft.retentionDays ?? ''}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    retentionDays: event.target.value === '' ? null : Number(event.target.value),
                  })
                }
              />
            )}
          </Field>

          <Field
            id="recipients"
            label="Destinataires des réponses"
            hint="Facultatif, mais utile : les répondants savent alors à qui ils s’adressent."
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="text"
                value={draft.recipients ?? ''}
                maxLength={2000}
                onChange={(event) => setDraft({ ...draft, recipients: event.target.value || null })}
              />
            )}
          </Field>

          <label className="sp-choice">
            <input
              type="checkbox"
              checked={draft.requireConsent}
              onChange={(event) => setDraft({ ...draft, requireConsent: event.target.checked })}
            />
            <span className="sp-choice__label">
              Demander un consentement explicite avant l’envoi
              <span className="sp-choice__desc">
                Un dernier écran récapitule les mentions ci-dessus et exige une case cochée.
                Le texte affiché est enregistré avec la réponse.
              </span>
            </span>
          </label>
        </section>
        </>
      ) : null}

      {currentStep === 'publication' ? (
        <>
        {/* Ce qui manque pour publier, en tête et en permanence : découvrir
            après avoir cliqué qu'il manquait une mention fait perdre le geste,
            et parfois l'heure de travail qui l'a précédé. */}
        {missing.length === 0 ? (
          <Callout mark="✓" title="Prêt à publier">
            Toutes les informations obligatoires sont renseignées.
          </Callout>
        ) : (
          <Callout mark="!" tone="muted" title="Avant de pouvoir publier">
            <ul className="sp-todo">
              {missing.map((requirement) => {
                const target = stepForRequirement(requirement);
                return (
                  <li key={requirement.key}>
                    {/* Chaque manque RENVOIE à l'endroit où le corriger. Dire
                        « section Informations » sans y conduire laisse
                        chercher, alors que l'écran sait où c'est. */}
                    {target ? (
                      <button
                        className="sp-todo__jump"
                        type="button"
                        onClick={() => leaveFor(target)}
                      >
                        {requirement.label}
                      </button>
                    ) : (
                      <strong>{requirement.label}</strong>
                    )}
                    <span>{requirement.where}</span>
                  </li>
                );
              })}
            </ul>
          </Callout>
        )}

          <section className="sp-card sp-stack">
            <h2 className="sp-card__title">Adresse publique</h2>
            <p className="sp-muted">
              C’est le lien à partager avec les répondants. Il ne fonctionne qu’une
              fois le formulaire publié.
            </p>
            <p className="sp-recap__url">{publicUrl}</p>
            <p>
              <a
                className="sp-btn sp-btn--outline sp-btn--sm"
                href={`/admin/sondages/${surveyId}/reponses`}
              >
                Voir les réponses
              </a>
            </p>
          </section>
        </>
      ) : null}

      <div className="sp-wizard__foot">
        <div className="sp-wizard__foot-inner">
          <div className="sp-wizard__foot-progress">
            <Steps
              current={editorStepNumber(currentStep)}
              total={EDITOR_TOTAL}
              label={editorStep(currentStep).label}
            />
            <button
              className="sp-btn sp-btn--ghost sp-btn--sm"
              type="button"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? (
                <>
                  <span aria-hidden="true" className="sp-spinner" />
                  Enregistrement…
                </>
              ) : (
                'Enregistrer'
              )}
            </button>
          </div>

          <div className="sp-wizard__foot-back">
            {previous ? (
              <button
                className="sp-btn sp-btn--ghost"
                type="button"
                onClick={() => goTo(previous)}
              >
                Retour
              </button>
            ) : null}
          </div>

          <div className="sp-wizard__foot-next">
            {next ? (
              <button className="sp-btn" type="button" onClick={goNext} disabled={saving}>
                Continuer
              </button>
            ) : draft.status !== 'published' ? (
              <button
                className="sp-btn"
                type="button"
                onClick={() => void publish()}
                disabled={saving || missing.length > 0}
                // Le bouton désactivé DIT pourquoi : un contrôle inerte sans
                // explication laisse chercher ce qu'on a mal fait.
                title={
                  missing.length > 0
                    ? `Il manque : ${missing.map((entry) => entry.label).join(', ')}`
                    : undefined
                }
              >
                Publier le formulaire
              </button>
            ) : (
              <a
                className="sp-btn"
                href={publicUrl}
                rel="noreferrer"
                target="_blank"
              >
                Voir le formulaire publié
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Ajout d'une question : le TYPE est choisi d'abord, et il est ce qu'on
 * choisit — pas un réglage caché dans une liste déroulante.
 *
 * Le type détermine tout le reste de la question : ce qu'on peut saisir, ce
 * qui sera validé, ce qui sortira dans l'export. Le faire choisir en premier,
 * sur des cibles nommées et décrites, évite le geste le plus coûteux de
 * l'éditeur — ajouter « Texte court » par défaut, s'en apercevoir plus tard,
 * et devoir supprimer puis recréer la question, parce que changer le type
 * d'une question déjà répondue orphelinerait les réponses.
 */
const TYPE_HINTS: Readonly<Record<FieldType, string>> = {
  text: 'Une ligne : un nom, une référence.',
  textarea: 'Plusieurs lignes : un commentaire, une précision.',
  email: 'Adresse électronique, dont le format est vérifié.',
  tel: 'Numéro de téléphone, dont le format est vérifié.',
  number: 'Un nombre, avec minimum et maximum au choix.',
  date: 'Une date, choisie dans un calendrier.',
  select: 'Une réponse parmi plusieurs, dans une liste déroulante.',
  radio: 'Une réponse parmi plusieurs, toutes visibles.',
  checkbox: 'Plusieurs réponses possibles.',
  checkbox_grid: 'Un tableau de cases : plusieurs lignes, plusieurs colonnes.',
  scale: 'Une note sur une échelle, de 1 à 5 par exemple.',
};

function AddFieldControl({
  stepId,
  disabled,
  onAdd,
}: {
  stepId: string;
  disabled: boolean;
  onAdd: (type: FieldType) => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = `${stepId}-types`;

  if (disabled) {
    return (
      <p className="sp-muted">
        Ce formulaire a atteint le nombre maximal de questions.
      </p>
    );
  }

  if (!open) {
    return (
      <p>
        <button
          aria-controls={listId}
          aria-expanded={false}
          className="sp-btn sp-btn--outline"
          type="button"
          onClick={() => setOpen(true)}
        >
          Ajouter une question
        </button>
      </p>
    );
  }

  return (
    <fieldset className="sp-fieldset" id={listId}>
      <legend>Quel type de question ?</legend>
      <ul className="sp-types">
        {FIELD_TYPES.map((candidate) => (
          <li key={candidate}>
            <button
              className="sp-type"
              type="button"
              onClick={() => {
                onAdd(candidate);
                setOpen(false);
              }}
            >
              <span className="sp-type__name">{FIELD_TYPE_LABELS[candidate]}</span>
              <span className="sp-type__desc">{TYPE_HINTS[candidate]}</span>
            </button>
          </li>
        ))}
      </ul>
      <p>
        <button
          className="sp-btn sp-btn--ghost sp-btn--sm"
          type="button"
          onClick={() => setOpen(false)}
        >
          Annuler
        </button>
      </p>
    </fieldset>
  );
}
