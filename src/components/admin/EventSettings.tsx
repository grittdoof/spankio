'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Callout } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { Tooltip } from '@/components/ui/Tooltip';
import { composeEventNote, eventNote } from '@/lib/event/calendar-content';
import { availableTimeZones, isoToWallClock, wallClockToIso } from '@/lib/event/time';
import {
  detailCandidates,
  identityCandidates,
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
  /** Description du formulaire, reprise par la note automatique. */
  surveyDescription: string | null;
  organisationName: string;
  /** Adresse publique du formulaire, reprise par la note automatique. */
  publicUrl: string;
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
  surveyDescription,
  organisationName,
  publicUrl,
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

  /**
   * Note automatique et aperçu, calculés par les MÊMES fonctions que les liens
   * d'agenda et le fichier `.ics`. Un aperçu qui recomposerait le texte de son
   * côté finirait par montrer autre chose que ce que reçoit le répondant.
   */
  const automaticNote = composeEventNote({
    description: surveyDescription,
    organiser: draft.eventOrganiser ?? organisationName,
    url: publicUrl,
  });
  const custom = (draft.eventDetails ?? '').trim() !== '';
  const preview = eventNote({
    custom: draft.eventDetails,
    description: surveyDescription,
    organiser: draft.eventOrganiser ?? organisationName,
    url: publicUrl,
  });

  const presenceOptions = presenceCandidates(schema);
  const partyOptions = partyCandidates(schema);
  const identityOptions = identityCandidates(schema);
  const detailOptions = detailCandidates(schema);
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

                <Field
                  hint="Facultatif. Renseignée, elle donne un taux de remplissage et un nombre de places libres ; laissée vide, l’écran affiche l’effectif sans pourcentage — plutôt qu’un pourcentage calculé sur un total inventé."
                  id="evt-capacite"
                  label="Nombre de places"
                >
                  {(attributes) => (
                    <input
                      {...attributes}
                      className="sp-input"
                      inputMode="numeric"
                      max={1000000}
                      min={1}
                      onChange={(event) => {
                        const raw = event.target.value.trim();
                        const parsed = Number(raw);
                        patch({
                          attendance: {
                            ...draft.attendance,
                            ...(raw !== '' && Number.isInteger(parsed) && parsed > 0
                              ? { capacity: parsed }
                              : { capacity: undefined }),
                          },
                        });
                      }}
                      step={1}
                      type="number"
                      value={draft.attendance.capacity ?? ''}
                    />
                  )}
                </Field>
              </>
            ) : null}
          </>
        )}
      </section>

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">
          Liste d’accueil{' '}
          <Tooltip label="liste d’accueil">
            La liste affichée dans les statistiques montre une rangée par réponse.
            Pour qu’une rangée porte un NOM, il faut dire quelle question le
            contient : « Nom et prénom » n’existe pas plus que « Société » dans une
            plateforme générique.
          </Tooltip>
        </h2>
        <p className="sp-muted">
          Sans désignation, chaque rangée est titrée par son horodatage — exact, mais
          inutilisable à l’entrée d’un événement.
        </p>

        {identityOptions.length === 0 ? (
          <Callout mark="!" tone="muted">
            Aucune question de saisie courte dans ce formulaire. Ajoutez une question
            « texte », « adresse électronique » ou « téléphone », puis revenez ici.
          </Callout>
        ) : (
          <>
            <Field
              hint="Une question à réponse courte : nom, raison sociale, adresse électronique."
              id="evt-identite"
              label="Question qui nomme l’invité"
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
                          ? { identityField: event.target.value }
                          : { identityField: undefined }),
                      },
                    })
                  }
                  value={draft.attendance.identityField ?? ''}
                >
                  <option value="">Titrer les rangées par leur date</option>
                  {identityOptions.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              hint="Facultatif. Affiché sous le nom : société, agence, adresse électronique…"
              id="evt-detail"
              label="Seconde information affichée"
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
                          ? { detailField: event.target.value }
                          : { detailField: undefined }),
                      },
                    })
                  }
                  value={draft.attendance.detailField ?? ''}
                >
                  <option value="">Aucune</option>
                  {detailOptions
                    .filter((field) => field.id !== draft.attendance.identityField)
                    .map((field) => (
                      <option key={field.id} value={field.id}>
                        {field.label}
                      </option>
                    ))}
                </select>
              )}
            </Field>
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

        <fieldset className="sp-fieldset">
          <legend>
            Note ajoutée à l’agenda{' '}
            <Tooltip label="note d’agenda">
              C’est le texte que le répondant retrouvera dans son rendez-vous, des
              semaines plus tard. Le même part vers Google Agenda, Outlook et le
              fichier .ics.
            </Tooltip>
          </legend>

          <ul className="sp-picks">
            <li>
              <label className="sp-pick">
                <input
                  checked={!custom}
                  name="noteMode"
                  onChange={() => patch({ eventDetails: null })}
                  type="radio"
                  value="auto"
                />
                <span className="sp-pick__text">
                  <span className="sp-pick__name">Texte automatique</span>
                  <span className="sp-pick__desc">
                    Composé de la description du formulaire, de l’organisateur et du
                    lien vers l’invitation.
                  </span>
                </span>
              </label>
            </li>
            <li>
              <label className="sp-pick">
                <input
                  checked={custom}
                  name="noteMode"
                  onChange={() =>
                    // On part du texte automatique : commencer d'une page
                    // blanche ferait perdre le lien vers l'invitation sans que
                    // personne s'en aperçoive.
                    patch({ eventDetails: automaticNote ?? ' ' })
                  }
                  type="radio"
                  value="custom"
                />
                <span className="sp-pick__text">
                  <span className="sp-pick__name">Note personnalisée</span>
                  <span className="sp-pick__desc">
                    Vous écrivez le texte entier. Il remplace le texte automatique —
                    le lien n’y figurera que si vous l’y mettez.
                  </span>
                </span>
              </label>
            </li>
          </ul>

          {custom ? (
            <>
              <Field
                id="evt-details"
                label="Votre note"
                hint="Elle est reprise telle quelle, sauf au-delà de 900 caractères où elle est tronquée sur un espace."
              >
                {(attributes) => (
                  <textarea
                    {...attributes}
                    className="sp-textarea"
                    maxLength={4000}
                    onChange={(event) => patch({ eventDetails: event.target.value })}
                    rows={6}
                    value={draft.eventDetails ?? ''}
                  />
                )}
              </Field>

              {automaticNote ? (
                <p>
                  <button
                    className="sp-btn sp-btn--outline sp-btn--sm"
                    type="button"
                    onClick={() => patch({ eventDetails: automaticNote })}
                  >
                    Reprendre le texte automatique
                  </button>
                </p>
              ) : null}
            </>
          ) : null}

          {/* L'aperçu est produit par la MÊME fonction que les liens d'agenda
              et le fichier .ics : il ne peut donc pas montrer autre chose que
              ce que recevra le répondant. */}
          <div className="sp-note-preview">
            <p className="sp-note-preview__title">Ce que verra le répondant</p>
            {preview ? (
              <p className="sp-note-preview__body">{preview}</p>
            ) : (
              <p className="sp-muted">
                Aucune note : le rendez-vous n’aura ni description ni lien de retour.
              </p>
            )}
          </div>
        </fieldset>

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
