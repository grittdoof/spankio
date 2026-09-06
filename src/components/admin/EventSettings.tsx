'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Callout } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { Tooltip } from '@/components/ui/Tooltip';
import { availableTimeZones, isoToWallClock, wallClockToIso } from '@/lib/event/time';
import {
  partyCandidates,
  presenceCandidates,
  presenceValues,
  type AttendanceSettings,
} from '@/lib/survey/attendance';
import type { SurveySchema } from '@/lib/survey/schema';
import { BannerUpload } from './BannerUpload';
import { LocationPicker, type LatLng } from './LocationPicker';

/**
 * Réglages de l'événement : dates, lieu, organisateur, bannière.
 *
 * Séparé de l'éditeur de questions à dessein. Ce sont deux tâches distinctes —
 * « quelles informations je collecte » et « de quel événement il s'agit » — et
 * les mêler produirait un écran interminable où l'essentiel se perd.
 *
 * Les dates sont saisies en HEURE LOCALE DU FUSEAU DE L'ÉVÉNEMENT, jamais en
 * heure du navigateur : un organisateur qui règle son événement depuis un autre
 * pays doit obtenir le même horaire qu'en le réglant sur place.
 */

export interface EventDraft {
  /** Comptage des présents. Rangé dans `settings`, jamais en colonne. */
  attendance: AttendanceSettings;
  bannerPath: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  eventAllDay: boolean;
  eventTimezone: string;
  eventLocationLabel: string | null;
  eventAddress: string | null;
  eventLat: number | null;
  eventLng: number | null;
  eventOrganiser: string | null;
  eventDetails: string | null;
}

export interface EventSettingsProps {
  organisationId: string;
  surveyId: string;
  initial: EventDraft;
  /** Schéma du formulaire : il fournit les questions à désigner. */
  schema: SurveySchema;
  onSave: (
    draft: EventDraft,
  ) => Promise<{ ok: true } | { ok: false; fields?: Record<string, string>; message?: string }>;
}

const TIME_ZONES = availableTimeZones();

/**
 * Liste des fuseaux proposés, GARANTIE de contenir celui de l'événement.
 *
 * `Intl.supportedValuesOf('timeZone')` ne renvoie pas tous les identifiants
 * acceptés — « UTC » en est absent, alors que le moteur le comprend. Un fuseau
 * enregistré mais absent de la liste laisserait la `select` afficher sa
 * première option : l'écran montrerait un fuseau, la base en contiendrait un
 * autre, et le premier enregistrement écraserait le bon.
 */
function timeZoneOptions(current: string): string[] {
  return TIME_ZONES.includes(current) ? TIME_ZONES : [current, ...TIME_ZONES];
}

export function EventSettings({
  organisationId,
  surveyId,
  initial,
  schema,
  onSave,
}: EventSettingsProps) {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const patch = (changes: Partial<EventDraft>) => {
    setDraft((previous) => ({ ...previous, ...changes }));
    setNotice(null);
  };

  const zone = draft.eventTimezone || 'Europe/Paris';

  const presenceOptions = presenceCandidates(schema);
  const partyOptions = partyCandidates(schema);
  const presenceValueOptions = presenceValues(schema, draft.attendance.presenceField);

  /**
   * Changer de question de présence RÉINITIALISE la valeur attendue : celle de
   * l'ancienne question n'existe pas dans la nouvelle, et la conserver
   * produirait un comptage qui ne se déclenche jamais.
   */
  const setPresenceField = (fieldId: string) => {
    if (fieldId === '') {
      patch({ attendance: {} });
      return;
    }
    const first = presenceValues(schema, fieldId)[0]?.value;
    patch({
      attendance: {
        ...draft.attendance,
        presenceField: fieldId,
        ...(first ? { presenceValue: first } : { presenceValue: undefined }),
      },
    });
  };

  const setMoment = (key: 'eventStartsAt' | 'eventEndsAt', wallClock: string) => {
    if (wallClock === '') {
      patch({ [key]: null });
      return;
    }
    const iso = wallClockToIso(wallClock, zone);
    // Une saisie incomplète (« 2026-03- ») ne produit pas d'instant : on ne
    // remplace pas la valeur enregistrée par une date inventée.
    if (iso) patch({ [key]: iso });
  };

  /**
   * Changer de fuseau CONSERVE l'heure de calendrier affichée et recalcule
   * l'instant. Corriger « Europe/Paris » en « Europe/Lisbon » veut dire « 18 h
   * à Lisbonne », pas « la même seconde absolue, affichée autrement ».
   */
  const setTimeZone = (next: string) => {
    const startWall = isoToWallClock(draft.eventStartsAt, zone);
    const endWall = isoToWallClock(draft.eventEndsAt, zone);
    patch({
      eventTimezone: next,
      eventStartsAt: startWall ? wallClockToIso(startWall, next) : null,
      eventEndsAt: endWall ? wallClockToIso(endWall, next) : null,
    });
  };

  const location: LatLng | null =
    draft.eventLat !== null && draft.eventLng !== null
      ? { latitude: draft.eventLat, longitude: draft.eventLng }
      : null;

  const save = async () => {
    setSaving(true);
    setErrors({});
    setNotice(null);
    const result = await onSave(draft);
    setSaving(false);

    if (result.ok) {
      setNotice('Réglages de l’événement enregistrés.');
      return;
    }
    setErrors(result.fields ?? {});
    setNotice(result.message ?? 'L’enregistrement a échoué.');
  };

  const endBeforeStart =
    draft.eventStartsAt !== null &&
    draft.eventEndsAt !== null &&
    new Date(draft.eventEndsAt).getTime() < new Date(draft.eventStartsAt).getTime();

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1.5rem' } as React.CSSProperties}>
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
        <h2 className="sp-card__title">Quand</h2>

        <Field
          id="evt-fuseau"
          label="Fuseau horaire de l’événement"
          hint="Les horaires ci-dessous sont saisis et affichés dans ce fuseau."
        >
          {(attributes) => (
            <select
              {...attributes}
              className="sp-select"
              value={zone}
              onChange={(event) => setTimeZone(event.target.value)}
            >
              {timeZoneOptions(zone).map((candidate) => (
                <option key={candidate} value={candidate}>
                  {candidate}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id="evt-debut"
          label="Début"
          error={errors['eventStartsAt']}
          required
          hint="Obligatoire pour publier un événement."
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              type="datetime-local"
              value={isoToWallClock(draft.eventStartsAt, zone)}
              onChange={(event) => setMoment('eventStartsAt', event.target.value)}
            />
          )}
        </Field>

        <Field
          id="evt-fin"
          label="Fin"
          error={endBeforeStart ? 'La fin précède le début.' : errors['eventEndsAt']}
          hint="Facultative. Sans fin, aucune durée n’est inventée dans l’agenda."
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              type="datetime-local"
              value={isoToWallClock(draft.eventEndsAt, zone)}
              onChange={(event) => setMoment('eventEndsAt', event.target.value)}
            />
          )}
        </Field>

        <label className="sp-choice">
          <input
            checked={draft.eventAllDay}
            type="checkbox"
            onChange={(event) => patch({ eventAllDay: event.target.checked })}
          />
          <span className="sp-choice__label">
            Journée entière
            <span className="sp-choice__desc">
              L’agenda affiche une date sans horaire.
            </span>
          </span>
        </label>
      </section>

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Où</h2>

        <Field id="evt-lieu" label="Nom du lieu">
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              maxLength={200}
              type="text"
              value={draft.eventLocationLabel ?? ''}
              onChange={(event) =>
                patch({ eventLocationLabel: event.target.value || null })
              }
            />
          )}
        </Field>

        <Field
          id="evt-adresse"
          label="Adresse"
          hint="Utilisée pour l’itinéraire proposé aux répondants."
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              maxLength={300}
              type="text"
              value={draft.eventAddress ?? ''}
              onChange={(event) => patch({ eventAddress: event.target.value || null })}
            />
          )}
        </Field>

        <LocationPicker
          value={location}
          onChange={(next) =>
            patch({
              eventLat: next?.latitude ?? null,
              eventLng: next?.longitude ?? null,
            })
          }
          onAddressPicked={(label) => {
            // L'adresse n'est remplie que si elle est vide : une adresse saisie
            // à la main est plus juste qu'un libellé de géocodeur, et l'écraser
            // ferait perdre un travail délibéré.
            setDraft((previous) =>
              previous.eventAddress ? previous : { ...previous, eventAddress: label },
            );
          }}
        />
      </section>

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">
          Compter les présents{' '}
          <Tooltip label="comptage des présents">
            La plateforme ne peut pas deviner laquelle de vos questions signifie « je
            viens » : vous la désignez ici. Sans cela, le tableau de bord compte des
            réponses, ce qui reste exact mais ne donne pas d’effectif.
          </Tooltip>
        </h2>
        <p className="sp-muted">
          Une fois ces questions désignées, la page des réponses affiche le nombre de
          personnes attendues et une liste d’invités exploitable à l’accueil.
        </p>

        {presenceOptions.length === 0 ? (
          <Callout mark="!" tone="muted">
            Aucune question à choix unique dans ce formulaire. Ajoutez-en une — par
            exemple « Serez-vous présent ? » avec « Oui » et « Non » — puis revenez ici.
          </Callout>
        ) : (
          <>
            <Field
              id="evt-presence"
              label="Question qui dit si la personne vient"
              hint="Seules les questions à choix unique peuvent servir : une réponse libre ne se compare pas de façon fiable."
            >
              {(attributes) => (
                <select
                  {...attributes}
                  className="sp-select"
                  onChange={(event) => setPresenceField(event.target.value)}
                  value={draft.attendance.presenceField ?? ''}
                >
                  <option value="">Ne pas compter les présents</option>
                  {presenceOptions.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {draft.attendance.presenceField ? (
              <Field
                id="evt-presence-valeur"
                label="Réponse qui signifie « je viens »"
              >
                {(attributes) => (
                  <select
                    {...attributes}
                    className="sp-select"
                    onChange={(event) =>
                      patch({
                        attendance: {
                          ...draft.attendance,
                          presenceValue: event.target.value,
                        },
                      })
                    }
                    value={draft.attendance.presenceValue ?? ''}
                  >
                    {presenceValueOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ) : null}

            {draft.attendance.presenceField ? (
              <>
                <Field
                  id="evt-effectif"
                  label="Question donnant le nombre de personnes"
                  hint="Facultatif. Sans elle, chaque réponse présente compte pour une personne."
                >
                  {(attributes) => (
                    <select
                      {...attributes}
                      className="sp-select"
                      onChange={(event) =>
                        patch({
                          attendance: {
                            ...draft.attendance,
                            ...(event.target.value
                              ? { partyField: event.target.value }
                              : { partyField: undefined }),
                          },
                        })
                      }
                      value={draft.attendance.partyField ?? ''}
                    >
                      <option value="">Une personne par réponse</option>
                      {partyOptions.map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>

                {draft.attendance.partyField ? (
                  <fieldset className="sp-fieldset">
                    <legend>Ce nombre compte…</legend>
                    <ul className="sp-picks">
                      <li>
                        <label className="sp-pick">
                          <input
                            checked={(draft.attendance.partyMode ?? 'extra') === 'extra'}
                            name="partyMode"
                            onChange={() =>
                              patch({
                                attendance: { ...draft.attendance, partyMode: 'extra' },
                              })
                            }
                            type="radio"
                            value="extra"
                          />
                          <span className="sp-pick__text">
                            <span className="sp-pick__name">Les accompagnants</span>
                            <span className="sp-pick__desc">
                              Le répondant s’ajoute : « 2 » vaut trois personnes.
                            </span>
                          </span>
                        </label>
                      </li>
                      <li>
                        <label className="sp-pick">
                          <input
                            checked={draft.attendance.partyMode === 'total'}
                            name="partyMode"
                            onChange={() =>
                              patch({
                                attendance: { ...draft.attendance, partyMode: 'total' },
                              })
                            }
                            type="radio"
                            value="total"
                          />
                          <span className="sp-pick__text">
                            <span className="sp-pick__name">Le total</span>
                            <span className="sp-pick__desc">
                              Le répondant est déjà compté : « 2 » vaut deux personnes.
                            </span>
                          </span>
                        </label>
                      </li>
                    </ul>
                  </fieldset>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Présentation</h2>

        <Field id="evt-organisateur" label="Organisateur affiché">
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              maxLength={200}
              type="text"
              value={draft.eventOrganiser ?? ''}
              onChange={(event) => patch({ eventOrganiser: event.target.value || null })}
            />
          )}
        </Field>

        <Field
          id="evt-details"
          label="Précisions"
          hint="Reprises dans le fichier d’agenda téléchargé par les répondants."
        >
          {(attributes) => (
            <textarea
              {...attributes}
              className="sp-textarea"
              maxLength={4000}
              rows={4}
              value={draft.eventDetails ?? ''}
              onChange={(event) => patch({ eventDetails: event.target.value || null })}
            />
          )}
        </Field>

        <BannerUpload
          organisationId={organisationId}
          surveyId={surveyId}
          value={draft.bannerPath}
          onChange={(path) => patch({ bannerPath: path })}
        />
      </section>

      <div className="sp-actions sp-builder__footer sp-sticky-bottom">
        <button className="sp-btn" disabled={saving} type="button" onClick={() => void save()}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <a className="sp-btn sp-btn--ghost" href={`/admin/sondages/${surveyId}`}>
          Questions du formulaire
        </a>
      </div>
    </div>
  );
}
