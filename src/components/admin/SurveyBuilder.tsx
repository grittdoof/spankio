'use client';

import { useCallback, useMemo, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Field } from '@/components/ui/Field';
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
import { legalBasisLabel } from '@/lib/survey/consent';
import { FIELD_TYPES, type FieldType, type SurveySchema } from '@/lib/survey/schema';
import type { SurveySettings } from '@/lib/survey/settings';
import { validateSurveySchema } from '@/lib/survey/schema';
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
  onSave: (draft: SurveyDraft) => Promise<{ ok: true } | { ok: false; fields?: Record<string, string>; message?: string }>;
}

export function SurveyBuilder({ surveyId, initial, publicUrl, onSave }: SurveyBuilderProps) {
  const [draft, setDraft] = useState<SurveyDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const schema = draft.schema;
  const used = useMemo(() => usedIdentifiers(schema), [schema]);

  /** Validité annoncée en continu, par le validateur du serveur. */
  const validity = useMemo(() => validateSurveySchema(schema), [schema]);

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
    setNotice(null);

    const result = await onSave(draft);
    setSaving(false);

    if (result.ok) {
      setNotice('Enregistré.');
      return;
    }
    setErrors(result.fields ?? {});
    setNotice(result.message ?? 'L’enregistrement a échoué.');
  };

  const publish = async () => {
    const next = { ...draft, status: 'published' as const };
    setDraft(next);
    setSaving(true);
    setErrors({});

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
    setNotice(result.message ?? 'Publication impossible.');
  };

  return (
    <div className="sp-builder sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
      {/* UNE seule zone d'annonce. Deux `role="alert"` simultanés
          interrompraient deux fois le lecteur d'écran pour un même événement,
          et la seconde interruption écraserait souvent la première. */}
      {Object.keys(errors).length > 0 ? (
        <Alert tone="error" title={notice ?? 'À corriger avant de continuer'}>
          <ul>
            {Object.entries(errors).map(([path, message]) => (
              <li key={path}>{message}</li>
            ))}
          </ul>
        </Alert>
      ) : notice ? (
        <Alert tone="success">{notice}</Alert>
      ) : null}

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Identité du formulaire</h2>

        <Field id="titre" label="Titre" required>
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

        <Field id="slug" label="Adresse publique" hint={publicUrl}>
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

      <section className="sp-stack">
        <div className="sp-card__header">
          <h2>Questions</h2>
          <p className="sp-muted">
            {validity.ok
              ? 'Le formulaire est valide.'
              : 'Le formulaire n’est pas encore publiable.'}
          </p>
        </div>

        {schema.steps.length === 0 ? (
          <div className="sp-card">
            <p className="sp-muted">
              Aucune question pour l’instant. Ajoutez une étape pour commencer.
            </p>
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

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Information des répondants</h2>
        <p className="sp-muted">
          Ces mentions sont affichées avant l’envoi et conservées comme preuve avec chaque
          réponse. Elles sont obligatoires pour publier.
        </p>

        <Field id="purpose" label="Finalité" error={errors['purpose']} required>
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

        <Field id="legalBasis" label="Base légale" error={errors['legalBasis']} required>
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
                  {legalBasisLabel(basis)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id="retentionDays"
          label="Durée de conservation (en jours)"
          error={errors['retentionDays']}
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

        <Field id="recipients" label="Destinataires des réponses">
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
          </span>
        </label>
      </section>

      <div className="sp-actions sp-builder__footer sp-sticky-bottom">
        <button className="sp-btn" type="button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {draft.status !== 'published' ? (
          <button
            className="sp-btn sp-btn--outline"
            type="button"
            onClick={() => void publish()}
            disabled={saving}
          >
            Publier
          </button>
        ) : (
          <a className="sp-btn sp-btn--outline" href={publicUrl} target="_blank" rel="noreferrer">
            Voir le formulaire publié
          </a>
        )}
        <a className="sp-btn sp-btn--ghost" href={`/admin/sondages/${surveyId}/reponses`}>
          Réponses
        </a>
      </div>
    </div>
  );
}

/** Ajout d'une question : le type est choisi avant, pas après. */
function AddFieldControl({
  stepId,
  disabled,
  onAdd,
}: {
  stepId: string;
  disabled: boolean;
  onAdd: (type: FieldType) => void;
}) {
  const [type, setType] = useState<FieldType>('text');
  const id = `${stepId}-ajout`;

  return (
    <div className="sp-row sp-row--end">
      <Field id={id} label="Ajouter une question">
        {(attributes) => (
          <select
            {...attributes}
            className="sp-select"
            value={type}
            onChange={(event) => setType(event.target.value as FieldType)}
          >
            {FIELD_TYPES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {FIELD_TYPE_LABELS[candidate]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <button
        className="sp-btn sp-btn--outline"
        type="button"
        disabled={disabled}
        onClick={() => onAdd(type)}
      >
        Ajouter
      </button>
    </div>
  );
}
