import { fr } from '@/lib/i18n/fr';

/**
 * Ajouter à l'agenda, et y aller.
 *
 * Présent DÈS L'ACCUEIL, avant même l'inscription : un destinataire qui reçoit
 * une invitation veut d'abord bloquer la date. L'obliger à s'inscrire pour
 * pouvoir noter le rendez-vous inverse l'ordre naturel des gestes — et le
 * même bloc réapparaît sur l'écran de confirmation, où il sert de rappel.
 *
 * Ordre des itinéraires : Google Maps d'abord. Ce n'est pas une préférence
 * pour ce service — les tuiles de la plateforme viennent d'OpenStreetMap —
 * mais l'application que la plupart des destinataires ont déjà ouverte. Les
 * deux autres restent proposées, sans hiérarchie de deuxième rang.
 */

export interface CalendarActions {
  readonly google: string;
  readonly outlook: string;
  readonly ics: string;
}

export interface DirectionsActions {
  readonly google: string;
  readonly openStreetMap: string;
  readonly apple: string;
}

export interface EventActionsProps {
  calendar?: CalendarActions | undefined;
  directions?: DirectionsActions | undefined;
  /** Titres de niveau 3 par défaut ; niveau 2 quand le bloc est seul. */
  headingLevel?: 2 | 3;
}

export function EventActions({ calendar, directions, headingLevel = 3 }: EventActionsProps) {
  if (!calendar && !directions) return null;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <div className="sp-event-actions">
      {calendar ? (
        <section className="sp-actions-block">
          <Heading className="sp-actions-block__title">{fr.survey.addToCalendar}</Heading>
          <div className="sp-actions">
            <a
              className="sp-btn sp-btn--outline sp-btn--sm"
              href={calendar.google}
              rel="noreferrer"
              target="_blank"
            >
              Google Agenda
            </a>
            <a
              className="sp-btn sp-btn--outline sp-btn--sm"
              href={calendar.outlook}
              rel="noreferrer"
              target="_blank"
            >
              Outlook
            </a>
            {/* Le fichier reste proposé : il fonctionne hors ligne, dans les
                clients lourds, et sans compte chez un tiers. */}
            <a className="sp-btn sp-btn--ghost sp-btn--sm" href={calendar.ics}>
              Autre agenda (.ics)
            </a>
          </div>
        </section>
      ) : null}

      {directions ? (
        <section className="sp-actions-block">
          <Heading className="sp-actions-block__title">{fr.survey.directions}</Heading>
          <div className="sp-actions">
            <a
              className="sp-btn sp-btn--outline sp-btn--sm"
              href={directions.google}
              rel="noreferrer"
              target="_blank"
            >
              Google Maps
            </a>
            <a
              className="sp-btn sp-btn--outline sp-btn--sm"
              href={directions.apple}
              rel="noreferrer"
              target="_blank"
            >
              Plans
            </a>
            <a
              className="sp-btn sp-btn--ghost sp-btn--sm"
              href={directions.openStreetMap}
              rel="noreferrer"
              target="_blank"
            >
              OpenStreetMap
            </a>
          </div>
        </section>
      ) : null}
    </div>
  );
}
