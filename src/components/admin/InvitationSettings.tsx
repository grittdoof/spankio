'use client';

import { useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { Callout } from '@/components/ui/Callout';
import { Field } from '@/components/ui/Field';
import { Tooltip } from '@/components/ui/Tooltip';
import { checkCtaColor, CTA_MIN_RATIO, CTA_PAGE_RATIO } from '@/lib/design/cta';
import type { SurveySettings } from '@/lib/survey/settings';
import {
  isBlockAllowed,
  PUBLIC_BLOCK_META,
  toggleBlock,
  type PublicBlock,
  type PublicDetail,
  type PublicMoment,
  type PublicPageSettings,
  type PublicQuestion,
} from '@/lib/survey/public-page';

/**
 * Réglages de la page publique d'un événement.
 *
 * Écran séparé des « réglages de l'événement », et non une carte de plus :
 * ce sont deux tâches distinctes. L'une établit des FAITS — quand, où, qui
 * organise, comment on compte les présents — l'autre décide de ce que l'invité
 * VOIT. Les mêler donnait un écran de plus de mille lignes où l'essentiel se
 * perdait.
 *
 * Deux règles d'organisation, toutes deux visibles à l'écran :
 *
 *  1. **L'interrupteur est à côté du contenu qu'il gouverne.** Le déroulé, le
 *     mot de l'organisateur et les questions fréquentes portent le leur.
 *     Ailleurs, on chercherait quel bouton commande quoi.
 *  2. **Un bloc autorisé mais vide ne s'affiche pas** — l'interrupteur dit
 *     « je veux ce bloc », il ne fabrique pas son contenu. L'écran le dit,
 *     plutôt que de laisser découvrir une section absente.
 */

/**
 * Textes des écrans d'encadrement.
 *
 * Ils vivent dans `settings.thankYou`, pas dans `settings.publicPage` : ce sont
 * des réglages du PARCOURS, antérieurs à cet écran. On les édite ici parce que
 * c'est là qu'on décide de ce que l'invité lit — et parce qu'ils n'étaient
 * éditables nulle part, ce qui obligeait à passer par la base pour changer une
 * phrase.
 */
export type InvitationTexts = Pick<SurveySettings, 'thankYou'>;

export interface InvitationSettingsProps {
  initial: PublicPageSettings;
  initialTexts: InvitationTexts;
  /** Adresse publique, pour aller voir le résultat. */
  publicUrl: string;
  /** Le formulaire est-il publié ? Sinon la page publique n'existe pas encore. */
  published: boolean;
  onSave: (
    draft: PublicPageSettings,
    texts: InvitationTexts,
  ) => Promise<{ ok: true } | { ok: false; message?: string }>;
}

/** Blocs dont le contenu se règle ailleurs sur cet écran. */
const BLOCKS_WITH_OWN_CARD: readonly PublicBlock[] = [
  'organiserWord',
  'programme',
  'faq',
  'directions',
];

export function InvitationSettings({
  initial,
  initialTexts,
  publicUrl,
  published,
  onSave,
}: InvitationSettingsProps) {
  const [draft, setDraft] = useState<PublicPageSettings>(initial);
  const [texts, setTexts] = useState<InvitationTexts>(initialTexts);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * La couleur saisie vit à part du brouillon tant qu'elle n'est pas valide.
   *
   * Sans cela, taper « #2F » au clavier écrirait une valeur invalide dans les
   * réglages, et le champ deviendrait inutilisable dès le second caractère —
   * on ne peut pas atteindre `#2F6FDB` sans passer par des états incomplets.
   */
  const [colorInput, setColorInput] = useState(initial.ctaColor ?? '');
  const verdict = colorInput.trim() === '' ? null : checkCtaColor(colorInput);

  const patch = (changes: Partial<PublicPageSettings>) => {
    setDraft((previous) => ({ ...previous, ...changes }));
    setNotice(null);
  };

  /**
   * Un texte effacé retire la clé au lieu d'enregistrer une chaîne vide : le
   * rendu retombe alors sur le libellé par défaut de l'interface, au lieu
   * d'afficher un titre vide.
   */
  const patchThankYou = (changes: Record<string, string>) => {
    setTexts((previous) => {
      const next = { ...(previous.thankYou ?? {}) } as Record<string, unknown>;
      for (const [key, value] of Object.entries(changes)) {
        if (value.trim() === '') delete next[key];
        else next[key] = value;
      }
      return { thankYou: next };
    });
    setNotice(null);
  };

  const allowed = (block: PublicBlock) => isBlockAllowed(draft, block);
  const setAllowed = (block: PublicBlock, value: boolean) =>
    patch({ hidden: toggleBlock(draft, block, value) });

  const details = draft.details ?? [];
  const programme = draft.programme ?? [];
  const faq = draft.faq ?? [];

  const save = async () => {
    // Refus AVANT l'appel réseau : le message nomme le ratio mesuré, ce
    // qu'une erreur du serveur ne saurait pas dire.
    if (verdict && !verdict.ok) {
      setNotice(null);
      setError(
        verdict.reason === 'format'
          ? 'La couleur du bouton doit s’écrire au format #RRGGBB — six chiffres hexadécimaux.'
          : `Cette couleur ne permet pas un libellé lisible : ${verdict.ratio.toFixed(2)}:1 au mieux, alors que ${CTA_MIN_RATIO}:1 sont exigés. Assombrissez-la ou éclaircissez-la.`,
      );
      return;
    }

    setSaving(true);
    setError(null);

    // La couleur est composée AU MOMENT de l'enregistrement, depuis la palette
    // validée — jamais recopiée du champ de saisie. Une seule source de vérité,
    // et ce qui partira est exactement ce que l'aperçu montrait.
    const result = await onSave(
      {
        ...draft,
        ...(verdict?.ok
          ? { ctaColor: verdict.palette.background }
          : { ctaColor: undefined }),
      },
      texts,
    );
    setSaving(false);
    if (result.ok) {
      setNotice('Page publique enregistrée.');
      return;
    }
    setError(result.message ?? 'L’enregistrement a été refusé.');
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': 'var(--sp-space-5)' } as React.CSSProperties}>
      {/* Une seule zone d'annonce : deux `role="alert"` simultanés
          interrompent deux fois le lecteur d'écran pour un même événement. */}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {!error && notice ? <Alert tone="success">{notice}</Alert> : null}

      {!published ? (
        <Callout mark="!" tone="muted">
          Ce formulaire n’est pas encore publié : la page publique n’existe donc pas.
          Ces réglages sont enregistrés et s’appliqueront dès la publication.
        </Callout>
      ) : null}

      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">
          Ce que la page affiche{' '}
          <Tooltip label="blocs de la page publique">
            Chaque bloc peut être fermé sans rien perdre : le contenu reste
            enregistré, il n’est simplement plus montré. Un bloc ouvert mais sans
            contenu ne s’affiche pas non plus — l’interrupteur ne fabrique rien.
          </Tooltip>
        </h2>
        <p className="sp-muted">
          Décochez ce que vous ne voulez pas montrer. Tout ce qui reste coché
          s’affiche, à condition d’avoir un contenu.
        </p>

        <fieldset className="sp-fieldset">
          <legend className="sp-visually-hidden">Blocs de la page publique</legend>
          <ul className="sp-picks">
            {PUBLIC_BLOCK_META.filter(
              (meta) => !BLOCKS_WITH_OWN_CARD.includes(meta.key),
            ).map((meta) => (
              <li key={meta.key}>
                <label className="sp-choice">
                  <input
                    checked={allowed(meta.key)}
                    onChange={(event) => setAllowed(meta.key, event.target.checked)}
                    type="checkbox"
                  />
                  <span className="sp-choice__label">
                    {meta.label}
                    <span className="sp-choice__desc">{meta.help}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        {allowed('status') ? (
          <Field
            hint="Par défaut : « Inscriptions ouvertes »."
            id="inv-statut"
            label="Texte de la pastille"
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                maxLength={60}
                onChange={(event) =>
                  patch({
                    ...(event.target.value.trim()
                      ? { statusLabel: event.target.value }
                      : { statusLabel: undefined }),
                  })
                }
                type="text"
                value={draft.statusLabel ?? ''}
              />
            )}
          </Field>
        ) : null}
      </section>

      {/* --- Écran de fin -------------------------------------------------- */}
      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Écran de fin</h2>
        <p className="sp-muted">
          Ce que l’invité lit juste après avoir envoyé sa réponse. Les liens
          d’agenda et d’itinéraire s’affichent en dessous, s’ils sont ouverts.
        </p>

        <Field
          hint="Par défaut : « Merci pour votre réponse »."
          id="inv-fin-titre"
          label="Titre"
        >
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              maxLength={300}
              onChange={(event) => patchThankYou({ title: event.target.value })}
              type="text"
              value={texts.thankYou?.title ?? ''}
            />
          )}
        </Field>

        <Field
          hint="Une phrase, pas un paragraphe : elle est lue une fois."
          id="inv-fin-phrase"
          label="Phrase"
        >
          {(attributes) => (
            <textarea
              {...attributes}
              className="sp-textarea"
              maxLength={2000}
              onChange={(event) => patchThankYou({ message: event.target.value })}
              rows={3}
              value={texts.thankYou?.message ?? ''}
            />
          )}
        </Field>
      </section>

      {/* --- Couleur du bouton -------------------------------------------- */}
      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">
          Couleur du bouton d’inscription{' '}
          <Tooltip label="couleur du bouton">
            Vous choisissez le FOND ; la couleur du libellé et celle du survol en
            découlent. Les laisser choisir aussi permettrait de fabriquer un bouton
            qu’on ne lit pas — c’est le seul appel à l’action de la page.
          </Tooltip>
        </h2>
        <p className="sp-muted">
          Par défaut, le bouton prend la couleur d’accent de la charte. Une couleur
          dont le libellé n’atteindrait pas {CTA_MIN_RATIO}:1 est refusée : sur une
          page publique, un bouton illisible n’est pas un choix esthétique.
        </p>

        <div className="sp-row">
          <Field
            hint="Sélecteur du système. Le code hexadécimal reste modifiable à côté."
            id="inv-cta-couleur"
            label="Choisir une couleur"
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-color"
                onChange={(event) => setColorInput(event.target.value.toUpperCase())}
                type="color"
                value={verdict?.ok ? verdict.palette.background : '#2F6FDB'}
              />
            )}
          </Field>

          <Field
            error={
              verdict && !verdict.ok
                ? verdict.reason === 'format'
                  ? 'Format attendu : #RRGGBB.'
                  : `Libellé illisible : ${verdict.ratio.toFixed(2)}:1 au mieux.`
                : null
            }
            hint="Collez ici le code de votre charte, par exemple #0B4A96."
            id="inv-cta-hex"
            label="Code hexadécimal"
          >
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                maxLength={7}
                onChange={(event) => setColorInput(event.target.value.toUpperCase())}
                placeholder="#RRGGBB"
                spellCheck={false}
                type="text"
                value={colorInput}
              />
            )}
          </Field>
        </div>

        {/* Aperçu du VRAI bouton, peint par la vraie palette : un carré de
            couleur ne dirait rien de la lisibilité du libellé, qui est
            justement ce qu'on vérifie ici. */}
        <div className="sp-cta-preview">
          <button
            className="sp-btn sp-btn--lg"
            disabled
            style={
              verdict?.ok
                ? ({
                    '--_bg': verdict.palette.background,
                    '--_bg-hover': verdict.palette.hover,
                    '--_fg': verdict.palette.ink,
                  } as React.CSSProperties)
                : undefined
            }
            type="button"
          >
            Je m’inscris
          </button>
          <div>
            <p className="sp-hint">
              {verdict?.ok
                ? `Contraste du libellé : ${verdict.palette.ratio.toFixed(2)}:1 au repos, ${verdict.palette.hoverRatio.toFixed(2)}:1 au survol.`
                : verdict
                  ? 'Aperçu indisponible : la couleur est refusée.'
                  : 'Aperçu avec la couleur d’accent de la charte.'}
            </p>
            {/* Signalé, pas refusé : un bouton reste identifiable par son
                libellé, et interdire tous les tons pâles au nom d'une règle
                qui ne s'applique pas serait un excès de zèle. */}
            {verdict?.ok && verdict.palette.pageRatio < CTA_PAGE_RATIO ? (
              <p className="sp-hint">
                Cette couleur se détache peu du fond de page sur thème clair
                ({verdict.palette.pageRatio.toFixed(2)}:1) : le libellé reste
                lisible, mais le contour du bouton se devine à peine.
              </p>
            ) : null}
          </div>
        </div>

        {colorInput.trim() !== '' ? (
          <p>
            <button
              className="sp-btn sp-btn--ghost sp-btn--sm"
              onClick={() => {
                setColorInput('');
                setNotice(null);
                setError(null);
              }}
              type="button"
            >
              Revenir à la couleur de la charte
            </button>
          </p>
        ) : null}
      </section>

      {/* --- Précisions pratiques ---------------------------------------- */}
      <section className="sp-card sp-stack">
        <h2 className="sp-card__title">Précisions pratiques</h2>
        <p className="sp-muted">
          La date et le lieu viennent des réglages de l’événement. Ajoutez ici ce
          qu’ils ne disent pas : tenue, vestiaire, restauration, badge à présenter.
          {allowed('practical')
            ? ''
            : ' Le bloc « informations pratiques » est actuellement fermé : rien de tout ceci ne s’affiche.'}
        </p>

        {details.length === 0 ? (
          <p className="sp-hint">Aucune précision pour l’instant.</p>
        ) : (
          <ul className="sp-option-list">
            {details.map((detail, index) => (
              <li key={index}>
                <div className="sp-row">
                  <Field id={`inv-detail-${index}-label`} label="Précision">
                    {(attributes) => (
                      <input
                        {...attributes}
                        className="sp-input"
                        maxLength={300}
                        onChange={(event) =>
                          patch({
                            details: replaceAt<PublicDetail>(details, index, {
                              ...detail,
                              label: event.target.value,
                            }),
                          })
                        }
                        type="text"
                        value={detail.label}
                      />
                    )}
                  </Field>
                  <Field id={`inv-detail-${index}-value`} label="Détail">
                    {(attributes) => (
                      <input
                        {...attributes}
                        className="sp-input"
                        maxLength={500}
                        onChange={(event) =>
                          patch({
                            details: replaceAt<PublicDetail>(details, index, {
                              ...detail,
                              ...(event.target.value
                                ? { value: event.target.value }
                                : { value: undefined }),
                            }),
                          })
                        }
                        type="text"
                        value={detail.value ?? ''}
                      />
                    )}
                  </Field>
                </div>
                <button
                  className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
                  onClick={() => patch({ details: removeAt(details, index) })}
                  type="button"
                >
                  <span aria-hidden="true">Retirer</span>
                  <span className="sp-visually-hidden">
                    Retirer la précision « {detail.label || 'sans titre' } »
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {details.length < 8 ? (
          <p>
            <button
              className="sp-btn sp-btn--outline sp-btn--sm"
              onClick={() => patch({ details: [...details, { label: '' }] })}
              type="button"
            >
              Ajouter une précision
            </button>
          </p>
        ) : (
          <p className="sp-hint">Huit précisions au maximum : au-delà, plus personne ne les lit.</p>
        )}
      </section>

      {/* --- Mot de l'organisateur --------------------------------------- */}
      <section className="sp-card sp-stack">
        <BlockSwitch
          allowed={allowed('organiserWord')}
          block="organiserWord"
          onToggle={setAllowed}
        />
        <p className="sp-muted">
          Quelques phrases signées, qui disent pourquoi cette invitation existe. Une
          ligne vide sépare deux paragraphes.
        </p>

        <div className="sp-row">
          <Field id="inv-mot-auteur" label="Signature">
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                maxLength={300}
                onChange={(event) =>
                  patch({
                    organiserWord: {
                      ...(draft.organiserWord ?? { text: '' }),
                      ...(event.target.value
                        ? { author: event.target.value }
                        : { author: undefined }),
                    },
                  })
                }
                type="text"
                value={draft.organiserWord?.author ?? ''}
              />
            )}
          </Field>
          <Field id="inv-mot-role" label="Fonction">
            {(attributes) => (
              <input
                {...attributes}
                className="sp-input"
                maxLength={300}
                onChange={(event) =>
                  patch({
                    organiserWord: {
                      ...(draft.organiserWord ?? { text: '' }),
                      ...(event.target.value
                        ? { role: event.target.value }
                        : { role: undefined }),
                    },
                  })
                }
                type="text"
                value={draft.organiserWord?.role ?? ''}
              />
            )}
          </Field>
        </div>

        <Field id="inv-mot-texte" label="Le mot">
          {(attributes) => (
            <textarea
              {...attributes}
              className="sp-textarea"
              maxLength={2000}
              onChange={(event) =>
                patch({
                  ...(event.target.value.trim()
                    ? {
                        organiserWord: {
                          ...(draft.organiserWord ?? {}),
                          text: event.target.value,
                        },
                      }
                    : { organiserWord: undefined }),
                })
              }
              rows={6}
              value={draft.organiserWord?.text ?? ''}
            />
          )}
        </Field>
      </section>

      {/* --- Déroulé ------------------------------------------------------ */}
      <section className="sp-card sp-stack">
        <BlockSwitch allowed={allowed('programme')} block="programme" onToggle={setAllowed} />
        <p className="sp-muted">
          Les moments de l’événement, dans l’ordre où vous les saisissez. L’heure est
          un texte libre : « 19h30 », « vers 21 h », « à l’issue du dîner ».
        </p>

        {programme.length === 0 ? (
          <p className="sp-hint">Aucun moment pour l’instant.</p>
        ) : (
          <ul className="sp-option-list">
            {programme.map((moment, index) => (
              <li key={index}>
                <div className="sp-row">
                  <Field id={`inv-moment-${index}-heure`} label="Heure">
                    {(attributes) => (
                      <input
                        {...attributes}
                        className="sp-input"
                        maxLength={40}
                        onChange={(event) =>
                          patch({
                            programme: replaceAt<PublicMoment>(programme, index, {
                              ...moment,
                              ...(event.target.value
                                ? { time: event.target.value }
                                : { time: undefined }),
                            }),
                          })
                        }
                        type="text"
                        value={moment.time ?? ''}
                      />
                    )}
                  </Field>
                  <Field id={`inv-moment-${index}-titre`} label="Ce qui se passe">
                    {(attributes) => (
                      <input
                        {...attributes}
                        className="sp-input"
                        maxLength={300}
                        onChange={(event) =>
                          patch({
                            programme: replaceAt<PublicMoment>(programme, index, {
                              ...moment,
                              title: event.target.value,
                            }),
                          })
                        }
                        type="text"
                        value={moment.title}
                      />
                    )}
                  </Field>
                </div>
                <Field id={`inv-moment-${index}-note`} label="Précision">
                  {(attributes) => (
                    <input
                      {...attributes}
                      className="sp-input"
                      maxLength={500}
                      onChange={(event) =>
                        patch({
                          programme: replaceAt<PublicMoment>(programme, index, {
                            ...moment,
                            ...(event.target.value
                              ? { note: event.target.value }
                              : { note: undefined }),
                          }),
                        })
                      }
                      type="text"
                      value={moment.note ?? ''}
                    />
                  )}
                </Field>
                <div className="sp-actions">
                  <button
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    disabled={index === 0}
                    onClick={() => patch({ programme: swap(programme, index, index - 1) })}
                    type="button"
                  >
                    <span aria-hidden="true">↑</span>
                    <span className="sp-visually-hidden">
                      Déplacer « {moment.title || 'ce moment'} » vers le haut
                    </span>
                  </button>
                  <button
                    className="sp-btn sp-btn--ghost sp-btn--sm"
                    disabled={index === programme.length - 1}
                    onClick={() => patch({ programme: swap(programme, index, index + 1) })}
                    type="button"
                  >
                    <span aria-hidden="true">↓</span>
                    <span className="sp-visually-hidden">
                      Déplacer « {moment.title || 'ce moment'} » vers le bas
                    </span>
                  </button>
                  <button
                    className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
                    onClick={() => patch({ programme: removeAt(programme, index) })}
                    type="button"
                  >
                    <span aria-hidden="true">Retirer</span>
                    <span className="sp-visually-hidden">
                      Retirer « {moment.title || 'ce moment'} »
                    </span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {programme.length < 20 ? (
          <p>
            <button
              className="sp-btn sp-btn--outline sp-btn--sm"
              onClick={() => patch({ programme: [...programme, { title: '' }] })}
              type="button"
            >
              Ajouter un moment
            </button>
          </p>
        ) : (
          <p className="sp-hint">Vingt moments au maximum.</p>
        )}
      </section>

      {/* --- S'y rendre --------------------------------------------------- */}
      <section className="sp-card sp-stack">
        <BlockSwitch allowed={allowed('directions')} block="directions" onToggle={setAllowed} />
        <Field
          hint="Transports, stationnement, entrée à emprunter. Aucune carte n’est affichée sur la page publique : seuls des liens sont proposés, donc rien ne part vers un tiers avant le clic."
          id="inv-acces"
          label="Accès"
        >
          {(attributes) => (
            <textarea
              {...attributes}
              className="sp-textarea"
              maxLength={500}
              onChange={(event) =>
                patch({
                  ...(event.target.value.trim()
                    ? { travelNote: event.target.value }
                    : { travelNote: undefined }),
                })
              }
              rows={3}
              value={draft.travelNote ?? ''}
            />
          )}
        </Field>
      </section>

      {/* --- Questions fréquentes ---------------------------------------- */}
      <section className="sp-card sp-stack">
        <BlockSwitch allowed={allowed('faq')} block="faq" onToggle={setAllowed} />
        <p className="sp-muted">
          Les questions que vos invités posent par courriel. Y répondre ici les évite
          une fois pour toutes.
        </p>

        {faq.length === 0 ? (
          <p className="sp-hint">Aucune question pour l’instant.</p>
        ) : (
          <ul className="sp-option-list">
            {faq.map((entry, index) => (
              <li key={index}>
                <Field id={`inv-faq-${index}-q`} label="Question">
                  {(attributes) => (
                    <input
                      {...attributes}
                      className="sp-input"
                      maxLength={300}
                      onChange={(event) =>
                        patch({
                          faq: replaceAt<PublicQuestion>(faq, index, {
                            ...entry,
                            question: event.target.value,
                          }),
                        })
                      }
                      type="text"
                      value={entry.question}
                    />
                  )}
                </Field>
                <Field id={`inv-faq-${index}-a`} label="Réponse">
                  {(attributes) => (
                    <textarea
                      {...attributes}
                      className="sp-textarea"
                      maxLength={2000}
                      onChange={(event) =>
                        patch({
                          faq: replaceAt<PublicQuestion>(faq, index, {
                            ...entry,
                            answer: event.target.value,
                          }),
                        })
                      }
                      rows={3}
                      value={entry.answer}
                    />
                  )}
                </Field>
                <button
                  className="sp-btn sp-btn--ghost sp-btn--sm sp-btn--danger-text"
                  onClick={() => patch({ faq: removeAt(faq, index) })}
                  type="button"
                >
                  <span aria-hidden="true">Retirer</span>
                  <span className="sp-visually-hidden">
                    Retirer la question « {entry.question || 'sans intitulé'} »
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {faq.length < 20 ? (
          <p>
            <button
              className="sp-btn sp-btn--outline sp-btn--sm"
              onClick={() => patch({ faq: [...faq, { question: '', answer: '' }] })}
              type="button"
            >
              Ajouter une question
            </button>
          </p>
        ) : (
          <p className="sp-hint">Vingt questions au maximum.</p>
        )}
      </section>

      <div className="sp-actions">
        <button className="sp-btn" disabled={saving} onClick={() => void save()} type="button">
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        {published ? (
          <a className="sp-btn sp-btn--outline" href={publicUrl} rel="noreferrer" target="_blank">
            Voir la page publique
          </a>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Interrupteur d'un bloc, posé en TITRE de sa carte.
 *
 * Le libellé et l'explication viennent de `PUBLIC_BLOCK_META`, donc du même
 * endroit que la liste de la première carte : deux formulations auraient fini
 * par se contredire.
 */
function BlockSwitch({
  block,
  allowed,
  onToggle,
}: {
  block: PublicBlock;
  allowed: boolean;
  onToggle: (block: PublicBlock, value: boolean) => void;
}) {
  const meta = PUBLIC_BLOCK_META.find((candidate) => candidate.key === block);
  if (!meta) return null;

  return (
    <label className="sp-choice">
      <input
        checked={allowed}
        onChange={(event) => onToggle(block, event.target.checked)}
        type="checkbox"
      />
      <span className="sp-choice__label">
        {meta.label}
        <span className="sp-choice__desc">{meta.help}</span>
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Manipulations de listes
// ---------------------------------------------------------------------------

function replaceAt<T>(list: readonly T[], index: number, value: T): T[] {
  return list.map((entry, position) => (position === index ? value : entry));
}

function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, position) => position !== index);
}

function swap<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const moved = next[from]!;
  next[from] = next[to]!;
  next[to] = moved;
  return next;
}
