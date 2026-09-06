'use client';

import { Field } from '@/components/ui/Field';
import {
  FIELD_TYPE_LABELS,
  uniqueIdentifier,
} from '@/lib/survey/builder';
import type { SurveyField, SurveyOption } from '@/lib/survey/schema';
import { ConditionEditor } from './ConditionEditor';

/**
 * Réglages d'une question.
 *
 * Choix structurant : la VALEUR d'une option est dérivée de son libellé à la
 * création, puis figée. On peut renommer « Oui » en « Oui, je viendrai » sans
 * rien casser, mais la valeur stockée dans les réponses ne bouge pas — la
 * modifier orphelinerait toutes les réponses déjà enregistrées, silencieusement.
 * La valeur est affichée pour information, jamais éditable.
 */

export interface FieldEditorProps {
  field: SurveyField;
  index: number;
  count: number;
  /** Champs qui précèdent celui-ci : seuls candidats à une condition. */
  conditionCandidates: readonly SurveyField[];
  onChange: (field: SurveyField) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}

function optionsOf(field: SurveyField): readonly SurveyOption[] {
  return 'options' in field ? field.options : [];
}

export function FieldEditor({
  field,
  index,
  count,
  conditionCandidates,
  onChange,
  onMove,
  onRemove,
}: FieldEditorProps) {
  const prefix = `${field.id}-editeur`;

  const patch = (changes: Partial<SurveyField>) =>
    onChange({ ...field, ...changes } as SurveyField);

  const setOptions = (options: SurveyOption[]) =>
    onChange({ ...field, options } as SurveyField);

  const addOption = () => {
    const options = optionsOf(field);
    const used = new Set(options.map((option) => option.value));
    setOptions([
      ...options,
      { value: uniqueIdentifier(`option ${options.length + 1}`, used), label: 'Nouvelle option' },
    ]);
  };

  return (
    <li className="sp-card sp-stack sp-field-editor">
      <div className="sp-field-editor__head">
        <p className="sp-badge">{FIELD_TYPE_LABELS[field.type]}</p>
        <div className="sp-actions">
          <button
            className="sp-btn sp-btn--ghost sp-btn--sm"
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
          >
            Monter<span className="sp-visually-hidden"> la question {field.label}</span>
          </button>
          <button
            className="sp-btn sp-btn--ghost sp-btn--sm"
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
          >
            Descendre<span className="sp-visually-hidden"> la question {field.label}</span>
          </button>
          <button
            className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
            type="button"
            onClick={onRemove}
          >
            Supprimer<span className="sp-visually-hidden"> la question {field.label}</span>
          </button>
        </div>
      </div>

      <Field id={`${prefix}-label`} label="Question posée" required>
        {(attributes) => (
          <input
            {...attributes}
            className="sp-input"
            type="text"
            value={field.label}
            maxLength={300}
            onChange={(event) => patch({ label: event.target.value })}
          />
        )}
      </Field>

      <Field id={`${prefix}-hint`} label="Aide affichée sous la question">
        {(attributes) => (
          <input
            {...attributes}
            className="sp-input"
            type="text"
            value={field.hint ?? ''}
            maxLength={500}
            onChange={(event) => patch({ hint: event.target.value || undefined })}
          />
        )}
      </Field>

      <label className="sp-choice">
        <input
          type="checkbox"
          checked={field.required}
          onChange={(event) => patch({ required: event.target.checked })}
        />
        <span className="sp-choice__label">Réponse obligatoire</span>
      </label>

      {'options' in field ? (
        <fieldset className="sp-fieldset">
          <legend className="sp-label">Options proposées</legend>
          <ul className="sp-option-list">
            {field.options.map((option, optionIndex) => (
              <li key={option.value}>
                <label className="sp-visually-hidden" htmlFor={`${prefix}-option-${option.value}`}>
                  Libellé de l’option {optionIndex + 1}
                </label>
                <input
                  id={`${prefix}-option-${option.value}`}
                  className="sp-input"
                  type="text"
                  value={option.label}
                  maxLength={300}
                  onChange={(event) =>
                    setOptions(
                      field.options.map((candidate) =>
                        candidate.value === option.value
                          ? { ...candidate, label: event.target.value }
                          : candidate,
                      ),
                    )
                  }
                />
                <code className="sp-option-value" title="Valeur enregistrée, non modifiable">
                  {option.value}
                </code>
                <button
                  className="sp-btn sp-btn--ghost sp-btn--sm"
                  type="button"
                  disabled={field.options.length <= 1}
                  onClick={() =>
                    setOptions(field.options.filter((candidate) => candidate.value !== option.value))
                  }
                >
                  Retirer
                  <span className="sp-visually-hidden"> l’option {option.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <button className="sp-btn sp-btn--outline sp-btn--sm" type="button" onClick={addOption}>
            Ajouter une option
          </button>

          <label className="sp-choice" style={{ marginTop: '0.75rem' }}>
            <input
              type="checkbox"
              checked={field.allowOther}
              onChange={(event) => patch({ allowOther: event.target.checked })}
            />
            <span className="sp-choice__label">
              Proposer « Autre » avec une saisie libre
            </span>
          </label>
        </fieldset>
      ) : null}

      {field.type === 'scale' ? (
        <div className="sp-row">
          <Field id={`${prefix}-min`} label="Valeur la plus basse">
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="number"
                value={field.min}
                min={0}
                max={100}
                onChange={(event) => patch({ min: Number(event.target.value) })}
              />
            )}
          </Field>
          <Field id={`${prefix}-max`} label="Valeur la plus haute">
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="number"
                value={field.max}
                min={0}
                max={100}
                onChange={(event) => patch({ max: Number(event.target.value) })}
              />
            )}
          </Field>
        </div>
      ) : null}

      {field.type === 'number' ? (
        <div className="sp-row">
          <Field id={`${prefix}-min`} label="Minimum accepté">
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="number"
                value={field.min ?? ''}
                onChange={(event) =>
                  patch({
                    min: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            )}
          </Field>
          <Field id={`${prefix}-max`} label="Maximum accepté">
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                type="number"
                value={field.max ?? ''}
                onChange={(event) =>
                  patch({
                    max: event.target.value === '' ? undefined : Number(event.target.value),
                  })
                }
              />
            )}
          </Field>
        </div>
      ) : null}

      <ConditionEditor
        candidates={conditionCandidates}
        condition={field.condition}
        prefix={prefix}
        onChange={(condition) => patch(condition ? { condition } : { condition: undefined })}
      />

    </li>
  );
}
