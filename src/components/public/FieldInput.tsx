'use client';

import { Field } from '@/components/ui/Field';
import { fr } from '@/lib/i18n/fr';
import { OTHER_VALUE, otherKey, type SurveyField } from '@/lib/survey/schema';

/**
 * Rendu d'un champ de sondage, pour les onze types du schéma.
 *
 * Choix d'accessibilité qui ne se voient pas mais se sentent :
 *  * les listes déroulantes sont de vraies `<select>` natives — sélecteur du
 *    système sur mobile, navigation clavier gratuite ;
 *  * les groupes de choix sont des `<fieldset>` avec `<legend>`, seule façon
 *    pour un lecteur d'écran d'annoncer la question avant les options ;
 *  * la grille est un vrai `<table>` avec en-têtes de ligne et de colonne
 *    associés, sinon une case cochée n'a aucun sens hors contexte visuel ;
 *  * chaque champ garde sa zone tactile de 44 px.
 */

export interface FieldInputProps {
  field: SurveyField;
  value: unknown;
  otherValue: string;
  error?: string | null;
  onChange: (fieldId: string, value: unknown) => void;
  /** Rend le champ prêt à recevoir le focus dès l'affichage de l'écran. */
  autoFocus?: boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const entries: unknown[] = value;
    return entries.filter((entry): entry is string => typeof entry === 'string');
  }
  return typeof value === 'string' && value !== '' ? [value] : [];
}

function asGrid(value: unknown): Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const result: Record<string, string[]> = {};
  for (const [row, columns] of Object.entries(value as Record<string, unknown>)) {
    result[row] = asList(columns);
  }
  return result;
}

export function FieldInput({
  field,
  value,
  otherValue,
  error,
  onChange,
  autoFocus,
}: FieldInputProps) {
  const describedById = `${field.id}-aide`;

  // Les groupes de choix et la grille portent leur propre étiquetage par
  // `fieldset`/`legend` : les envelopper dans un `<label>` associerait le
  // libellé au premier bouton radio seulement.
  if (field.type === 'radio' || field.type === 'checkbox') {
    const selected = field.type === 'checkbox' ? asList(value) : [asString(value)];
    const toggle = (optionValue: string) => {
      if (field.type === 'checkbox') {
        const next = selected.includes(optionValue)
          ? selected.filter((entry) => entry !== optionValue)
          : [...selected, optionValue];
        onChange(field.id, next);
      } else {
        onChange(field.id, optionValue);
      }
    };

    const options = [
      ...field.options,
      ...(field.allowOther ? [{ value: OTHER_VALUE, label: fr.survey.otherLabel }] : []),
    ];

    return (
      <fieldset className="sp-fieldset">
        <legend className="sp-question__legend">
          {field.label}
          {field.required ? <span className="sp-visually-hidden"> (obligatoire)</span> : null}
        </legend>
        {field.hint ? (
          <p className="sp-hint" id={describedById}>
            {field.hint}
          </p>
        ) : null}

        <div className="sp-choices">
          {options.map((option, index) => (
            <label className="sp-choice" key={option.value}>
              <input
                type={field.type === 'checkbox' ? 'checkbox' : 'radio'}
                name={field.id}
                value={option.value}
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
                aria-describedby={field.hint ? describedById : undefined}
                aria-invalid={error ? true : undefined}
                autoFocus={autoFocus && index === 0}
              />
              <span className="sp-choice__label">
                {option.label}
                {'description' in option && option.description ? (
                  <span className="sp-choice__desc">{option.description}</span>
                ) : null}
              </span>
            </label>
          ))}
        </div>

        {selected.includes(OTHER_VALUE) ? (
          <label className="sp-other">
            <span className="sp-visually-hidden">{fr.survey.otherPlaceholder}</span>
            <input
              className="sp-input"
              type="text"
              value={otherValue}
              placeholder={fr.survey.otherPlaceholder}
              maxLength={500}
              onChange={(event) => onChange(otherKey(field.id), event.target.value)}
            />
          </label>
        ) : null}

        {error ? <p className="sp-error">{error}</p> : null}
      </fieldset>
    );
  }

  if (field.type === 'checkbox_grid') {
    const grid = asGrid(value);
    const toggle = (row: string, column: string) => {
      const current = grid[row] ?? [];
      const next = field.singleChoicePerRow
        ? current.includes(column)
          ? []
          : [column]
        : current.includes(column)
          ? current.filter((entry) => entry !== column)
          : [...current, column];
      onChange(field.id, { ...grid, [row]: next });
    };

    return (
      <fieldset className="sp-fieldset">
        <legend className="sp-question__legend">{field.label}</legend>
        {field.hint ? <p className="sp-hint">{field.hint}</p> : null}

        <div className="sp-table-wrapper">
          <table className="sp-table sp-grid">
            <thead>
              <tr>
                <td />
                {field.columns.map((column) => (
                  <th scope="col" key={column.value}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {field.rows.map((row) => (
                <tr key={row.value}>
                  <th scope="row">{row.label}</th>
                  {field.columns.map((column) => (
                    <td key={column.value}>
                      <input
                        type={field.singleChoicePerRow ? 'radio' : 'checkbox'}
                        name={`${field.id}__${row.value}`}
                        checked={(grid[row.value] ?? []).includes(column.value)}
                        onChange={() => toggle(row.value, column.value)}
                        aria-label={`${row.label} — ${column.label}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error ? <p className="sp-error">{error}</p> : null}
      </fieldset>
    );
  }

  if (field.type === 'scale') {
    const current = asString(value);
    const values = Array.from(
      { length: field.max - field.min + 1 },
      (_, index) => field.min + index,
    );

    return (
      <fieldset className="sp-fieldset">
        <legend className="sp-question__legend">{field.label}</legend>
        {field.hint ? <p className="sp-hint">{field.hint}</p> : null}

        <div className="sp-scale">
          {values.map((entry, index) => (
            <label className="sp-scale__step" key={entry}>
              <input
                type="radio"
                name={field.id}
                value={entry}
                checked={current === String(entry)}
                onChange={() => onChange(field.id, entry)}
                autoFocus={autoFocus && index === 0}
              />
              <span className="sp-scale__value">{entry}</span>
            </label>
          ))}
        </div>

        {field.minLabel || field.maxLabel ? (
          <p className="sp-scale__legend">
            <span>{field.minLabel}</span>
            <span>{field.maxLabel}</span>
          </p>
        ) : null}

        {error ? <p className="sp-error">{error}</p> : null}
      </fieldset>
    );
  }

  // Le type de `field` est déjà réduit ici par les retours anticipés
  // ci-dessus, mais TypeScript perd cette réduction à l'intérieur d'une
  // fonction de rappel : on la fige dans une constante.
  const simple = field;

  const common = {
    label: field.label,
    ...(field.hint ? { hint: field.hint } : {}),
    ...(error ? { error } : {}),
    ...(field.required ? { required: true } : {}),
  };

  return (
    <Field id={field.id} {...common}>
      {(attributes) => {
        switch (simple.type) {
          case 'textarea':
            return (
              <textarea
                {...attributes}
                className="sp-textarea"
                rows={5}
                value={asString(value)}
                maxLength={simple.maxLength ?? 5000}
                placeholder={simple.placeholder}
                autoFocus={autoFocus}
                onChange={(event) => onChange(simple.id, event.target.value)}
              />
            );
          case 'select':
            return (
              <select
                {...attributes}
                className="sp-select"
                value={asString(value)}
                autoFocus={autoFocus}
                onChange={(event) => onChange(simple.id, event.target.value)}
              >
                <option value="">Choisir…</option>
                {simple.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                {simple.allowOther ? (
                  <option value={OTHER_VALUE}>{fr.survey.otherLabel}</option>
                ) : null}
              </select>
            );
          case 'number':
            return (
              <input
                {...attributes}
                className="sp-input"
                type="number"
                inputMode="decimal"
                value={asString(value)}
                min={simple.min}
                max={simple.max}
                step={simple.step}
                autoFocus={autoFocus}
                onChange={(event) => onChange(simple.id, event.target.value)}
              />
            );
          case 'date':
            return (
              <input
                {...attributes}
                className="sp-input"
                type="date"
                value={asString(value)}
                min={simple.min}
                max={simple.max}
                autoFocus={autoFocus}
                onChange={(event) => onChange(simple.id, event.target.value)}
              />
            );
          default:
            return (
              <input
                {...attributes}
                className="sp-input"
                type={simple.type === 'email' ? 'email' : simple.type === 'tel' ? 'tel' : 'text'}
                inputMode={simple.type === 'tel' ? 'tel' : undefined}
                autoComplete={
                  simple.type === 'email' ? 'email' : simple.type === 'tel' ? 'tel' : undefined
                }
                value={asString(value)}
                maxLength={simple.maxLength ?? 500}
                placeholder={simple.placeholder}
                autoFocus={autoFocus}
                onChange={(event) => onChange(simple.id, event.target.value)}
              />
            );
        }
      }}
    </Field>
  );
}
