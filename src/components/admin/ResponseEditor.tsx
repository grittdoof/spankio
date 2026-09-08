'use client';

import { useState } from 'react';
import { FieldInput } from '@/components/public/FieldInput';
import { Alert } from '@/components/ui/Alert';
import { Callout } from '@/components/ui/Callout';
import { visibleFields } from '@/lib/survey/conditions';
import { otherKey, type SurveySchema } from '@/lib/survey/schema';
import { validateResponse } from '@/lib/survey/validate-response';

/**
 * Correction d'une réponse déjà enregistrée.
 *
 * Quatre partis pris :
 *
 *  1. **Les mêmes champs que le répondant a vus.** Le formulaire réutilise
 *     `FieldInput`, le composant du parcours public : onze types de champs déjà
 *     accessibles, déjà testés. En réécrire une version « admin » aurait donné
 *     deux comportements pour une même question.
 *  2. **La même validation que le serveur.** `validateResponse` est appelée ici
 *     avec le schéma ; il n'existe aucune règle d'interface. L'écran ne peut
 *     donc pas accepter ce que la route refusera.
 *  3. **Les questions conditionnelles suivent la saisie.** Corriger « Serez-vous
 *     accompagné ? » fait apparaître ou disparaître la question du nombre,
 *     exactement comme côté répondant — sinon on enregistrerait une réponse
 *     que le moteur de conditions considère comme inapplicable.
 *  4. **Ce que la correction fait est DIT avant.** L'originale n'est pas
 *     réécrite : elle est conservée en suppression logique, et une copie
 *     corrigée la remplace. Une personne qui corrige une donnée personnelle
 *     doit savoir que l'ancienne version subsiste.
 */

export interface ResponseEditorProps {
  schema: SurveySchema;
  /** Réponses enregistrées, telles qu'elles ont été reçues. */
  initial: Readonly<Record<string, unknown>>;
  /** Horodatage de la soumission d'origine, conservé par la correction. */
  submittedAt: string;
  onSave: (
    data: Record<string, unknown>,
  ) => Promise<{ ok: true } | { ok: false; fields?: Record<string, string>; message?: string }>;
}

export function ResponseEditor({ schema, initial, submittedAt, onSave }: ResponseEditorProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({ ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const fields = visibleFields(schema, answers);

  const set = (fieldId: string, value: unknown) => {
    setAnswers((previous) => ({ ...previous, [fieldId]: value }));
    setErrors((previous) => {
      if (!(fieldId in previous)) return previous;
      const next = { ...previous };
      delete next[fieldId];
      return next;
    });
    setNotice(null);
  };

  const save = async () => {
    // La validation d'abord, et la MÊME que celle du serveur : inutile
    // d'aller-retour pour apprendre qu'un champ requis est vide.
    const validation = validateResponse(schema, answers);
    if (!validation.ok) {
      const found: Record<string, string> = {};
      for (const error of validation.errors) found[error.field] ??= error.code;
      setErrors(found);
      setFailure('Certaines réponses doivent être corrigées avant l’enregistrement.');
      return;
    }

    setSaving(true);
    setFailure(null);
    const result = await onSave(validation.value.data);
    setSaving(false);

    if (result.ok) {
      setErrors({});
      setNotice('Correction enregistrée. La version précédente reste conservée.');
      return;
    }
    if (result.fields) setErrors(result.fields);
    setFailure(result.message ?? 'La correction a été refusée.');
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-5)' } as React.CSSProperties}>
      {/* Une seule zone d'annonce à la fois. */}
      {failure ? <Alert tone="error">{failure}</Alert> : null}
      {!failure && notice ? <Alert tone="success">{notice}</Alert> : null}

      <Callout mark="i">
        <p>
          La réponse d’origine n’est pas réécrite : elle est conservée hors des
          comptages et des exports, et cette correction la remplace en gardant sa
          date de soumission et son consentement.
        </p>
        <p>
          C’est ce qui permet de corriger une donnée personnelle sans que la preuve
          du consentement cesse de correspondre à ce qui a été affiché au répondant.
        </p>
      </Callout>

      <section className="sp-card sp-stack">
        {fields.map(({ field }) => (
          <FieldInput
            error={errors[field.id] ?? null}
            field={field}
            key={field.id}
            onChange={set}
            otherValue={
              typeof answers[otherKey(field.id)] === 'string'
                ? (answers[otherKey(field.id)] as string)
                : ''
            }
            value={answers[field.id]}
          />
        ))}
      </section>

      <div className="sp-actions">
        <button className="sp-btn" disabled={saving} onClick={() => void save()} type="button">
          {saving ? 'Enregistrement…' : 'Enregistrer la correction'}
        </button>
        <p className="sp-hint">
          Réponse reçue le{' '}
          {new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'long',
            timeStyle: 'short',
            timeZone: 'Europe/Paris',
          }).format(new Date(submittedAt))}
          . Cette date est conservée.
        </p>
      </div>
    </div>
  );
}
