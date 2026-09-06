'use client';

import { Callout } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import {
  buildCondition,
  conditionOperators,
  conditionParts,
  conditionValues,
  describeCondition,
  operatorNeedsValue,
  type ConditionOperator,
} from '@/lib/survey/condition-options';
import type { Condition, SurveyField } from '@/lib/survey/schema';

/**
 * Condition d'affichage d'une question : quelle question observer, quoi en
 * dire, et à quelle réponse la comparer.
 *
 * Il n'y avait qu'un seul opérateur possible — « a une réponse » — alors que le
 * moteur en évalue six : impossible d'écrire « n'afficher que si la réponse est
 * *Oui* », qui est le besoin courant d'un formulaire d'inscription.
 *
 * Trois partis pris :
 *
 *  1. **La valeur se CHOISIT, jamais ne se saisit.** Comparer à une chaîne
 *     tapée au clavier donne une condition qui ne se déclenche jamais dès
 *     qu'un caractère diffère, sans que rien ne le signale.
 *  2. **Les opérateurs dépendent du type observé.** `equals` sur une case à
 *     cocher multiple échoue dès qu'une seconde case est cochée ; il n'est
 *     donc pas proposé. C'est `conditionOperators` qui tranche, et le même
 *     module vérifie la composition.
 *  3. **La condition est relue en une phrase.** Trois listes déroulantes se
 *     décodent ; une phrase se lit.
 *
 * Les conditions composées (`all` / `any`) existent dans le schéma mais ne se
 * construisent pas ici : l'écran affiche alors la phrase impossible à composer
 * et refuse d'y toucher, plutôt que de l'écraser au premier changement.
 */

export interface ConditionEditorProps {
  /** Questions qui précèdent : une condition ne regarde qu'en arrière. */
  candidates: readonly SurveyField[];
  condition: Condition | undefined;
  prefix: string;
  onChange: (condition: Condition | undefined) => void;
}

export function ConditionEditor({
  candidates,
  condition,
  prefix,
  onChange,
}: ConditionEditorProps) {
  const parts = conditionParts(condition);
  const observed = parts
    ? candidates.find((candidate) => candidate.id === parts.field)
    : undefined;

  const operators = observed ? conditionOperators(observed) : [];
  const values = observed ? conditionValues(observed) : [];
  const needsValue = parts ? operatorNeedsValue(parts.op) : false;
  const summary = describeCondition(condition, candidates);

  // Condition composée, ou question observée disparue : on ne propose pas de
  // la modifier par bribes — la remplacer entièrement est le seul geste sûr.
  const unsupported = condition !== undefined && parts === null;

  if (candidates.length === 0) {
    return (
      <Callout mark="i" tone="muted">
        Cette question est la première : une condition ne peut observer qu’une question
        qui la précède.
      </Callout>
    );
  }

  if (unsupported) {
    return (
      <Callout mark="!" tone="muted" title="Condition avancée">
        Cette question porte une condition combinée, que cet écran ne sait pas modifier.
        <p style={{ marginTop: 'var(--sp-space-3)' }}>
          <button
            className="sp-btn sp-btn--outline sp-btn--sm"
            type="button"
            onClick={() => onChange(undefined)}
          >
            Supprimer la condition
          </button>
        </p>
      </Callout>
    );
  }

  const pickField = (id: string) => {
    if (id === '') {
      onChange(undefined);
      return;
    }
    const next = candidates.find((candidate) => candidate.id === id);
    if (!next) return;

    // Premier opérateur du type observé, et sa première valeur s'il en exige
    // une : la condition est ainsi valide dès le choix de la question, sans
    // état intermédiaire qui ne se déclencherait jamais.
    const first = conditionOperators(next)[0];
    if (!first) return;
    const value = first.needsValue ? (conditionValues(next)[0]?.value ?? null) : null;
    onChange(buildCondition(next, first.op, value) ?? undefined);
  };

  const pickOperator = (op: ConditionOperator) => {
    if (!observed) return;
    const value = operatorNeedsValue(op) ? (parts?.value ?? values[0]?.value ?? null) : null;
    onChange(buildCondition(observed, op, value) ?? undefined);
  };

  const pickValue = (value: string) => {
    if (!observed || !parts) return;
    onChange(buildCondition(observed, parts.op, value) ?? undefined);
  };

  return (
    <div className="sp-condition">
      <Field
        id={`${prefix}-condition-champ`}
        label="N’afficher que si"
        hint="La question reste masquée tant que la condition n’est pas remplie."
      >
        {(attributes) => (
          <select
            {...attributes}
            className="sp-select"
            onChange={(event) => pickField(event.target.value)}
            value={parts?.field ?? ''}
          >
            <option value="">Toujours afficher</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      {observed && parts ? (
        <div className="sp-row">
          <Field id={`${prefix}-condition-op`} label="Condition">
            {(attributes) => (
              <select
                {...attributes}
                className="sp-select"
                onChange={(event) => pickOperator(event.target.value as ConditionOperator)}
                value={parts.op}
              >
                {operators.map((choice) => (
                  <option key={choice.op} value={choice.op}>
                    {choice.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {needsValue ? (
            <Field id={`${prefix}-condition-valeur`} label="Réponse attendue">
              {(attributes) => (
                <select
                  {...attributes}
                  className="sp-select"
                  onChange={(event) => pickValue(event.target.value)}
                  value={parts.value ?? ''}
                >
                  {values.map((choice) => (
                    <option key={choice.value} value={choice.value}>
                      {choice.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <p className="sp-condition__summary">
          Affichée si {summary}.
        </p>
      ) : null}
    </div>
  );
}
