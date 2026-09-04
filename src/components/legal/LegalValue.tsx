/**
 * Valeur juridique éventuellement absente.
 *
 * Quand le super administrateur n'a pas encore renseigné un champ, la page le
 * DIT au lieu d'afficher un vide ambigu ou une valeur inventée. Une mention
 * légale incomplète et signalée vaut mieux qu'une mention légale fausse.
 */
export function LegalValue({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined || value.trim() === '') {
    return <em className="sp-muted">Non renseigné</em>;
  }
  return <>{value}</>;
}
