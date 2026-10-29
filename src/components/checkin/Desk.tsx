'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  deskReducer,
  expectedVersionOf,
  nextOp,
  retryDelay,
  EMPTY_DESK,
  type CheckinState,
  type DeskState,
} from '@/lib/checkin/reducer';
import { deskList, deskStatusLabel, type DeskRow } from '@/lib/checkin/rows';
import { freshness, POLL_INTERVAL_MS } from '@/lib/checkin/freshness';
import { loadQueue, saveQueue } from '@/lib/checkin/storage';
import { normaliseSearch, type GuestRow } from '@/lib/survey/guests';
import { checkinErrorMessage } from '@/lib/i18n/fr';

/**
 * Le poste d'accueil.
 *
 * Un seul écran, tenu d'une main, debout. Tout ce qui décide de ce qui
 * s'affiche vit dans `src/lib/checkin/` et se teste sans navigateur ; ce
 * composant ne fait que trois choses — câbler le temps qui passe, envoyer la
 * file, et rendre.
 *
 * Deux règles d'accessibilité qui ne sont pas négociables ici :
 *
 *  - **La couleur ne porte rien.** Le besoin était formulé en vert et rouge ;
 *    chaque rangée porte donc son statut ÉCRIT, et la couleur ne fait que le
 *    renforcer. Sans cela, l'écran serait inutilisable pour une partie des
 *    gens, debout, dans une lumière de soirée.
 *  - **Une seule zone d'annonce.** Deux `role="status"` concurrents
 *    interrompraient deux fois le lecteur d'écran pour un même événement, et
 *    la seconde interruption écraserait la première.
 */

export interface DeskProps {
  readonly surveyId: string;
  readonly title: string;
  /** Liste composée côté serveur : l'écran est complet avant tout JavaScript. */
  readonly guests: readonly GuestRow[];
  readonly initialStates: readonly CheckinState[];
  /** Le comptage est-il désigné ? Sans lui, pas de statut annoncé. */
  readonly counting: boolean;
  readonly printHref: string;
  /**
   * Essai à blanc : les hôtesses s'entraînent, RIEN n'est envoyé ni compté, et
   * un rechargement remet à zéro. Le classique « on a découvert à 19 h 50 que
   * le compte ne marchait pas » disparaît, puisqu'ouvrir cet écran prouve déjà
   * que le compte fonctionne.
   */
  readonly rehearsal?: boolean;
}

type Filter = 'all' | 'awaited' | 'arrived';

const FILTER_LABELS: Readonly<Record<Filter, string>> = {
  all: 'Tous',
  awaited: 'À venir',
  arrived: 'Arrivés',
};

function initial(props: DeskProps): DeskState {
  const states: Record<string, CheckinState> = {};
  for (const one of props.initialStates) states[one.responseId] = one;
  let cursor: string | null = null;
  for (const one of props.initialStates) {
    if (cursor === null || one.updatedAt > cursor) cursor = one.updatedAt;
  }
  return { ...EMPTY_DESK, states, cursor };
}

export function Desk(props: DeskProps) {
  const { surveyId, guests, counting, printHref, title, rehearsal = false } = props;
  const [state, dispatch] = useReducer(deskReducer, props, initial);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [online, setOnline] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  /* Horloge du rendu : la fraîcheur se recalcule même sans nouvel événement,
     sinon « à jour il y a 3 s » resterait affiché pendant deux minutes. */
  const [tick, setTick] = useState(() => Date.now());

  const list = useMemo(() => deskList(guests, state), [guests, state]);

  const visible = useMemo(() => {
    const needle = normaliseSearch(search);
    return list.rows.filter((row) => {
      if (filter === 'arrived' && !row.arrived) return false;
      if (filter === 'awaited' && row.arrived) return false;
      if (needle === '') return true;
      const haystack = normaliseSearch(`${row.name ?? ''} ${row.detail ?? ''}`);
      return haystack.includes(needle);
    });
  }, [list.rows, search, filter, ]);

  // --- Reprise de la file laissée par une session précédente -----------------
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    /*
     * Pendant une répétition on ne RESTAURE rien, et c'est le point le plus
     * dangereux de ce mode. Une file réelle laissée par une session
     * précédente serait reprise ici, appliquée en local — puisque rien ne
     * part — puis effacée : des arrivées réelles disparaîtraient sans que
     * personne ne le sache.
     */
    if (rehearsal) return;
    for (const op of loadQueue(surveyId)) {
      dispatch({
        type: 'tap',
        opId: op.opId,
        responseId: op.responseId,
        arrived: op.arrived,
        peopleIn: op.peopleIn,
      });
    }
  }, [surveyId, rehearsal]);

  useEffect(() => {
    if (rehearsal) return;
    saveQueue(surveyId, state.queue);
  }, [surveyId, state.queue, rehearsal]);

  // --- Le temps qui passe, et le réseau qui va et vient ----------------------
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sync = () => setOnline(window.navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  // --- Le delta : le CONTRAT de fraîcheur -----------------------------------
  const cursor = state.cursor;
  useEffect(() => {
    let cancelled = false;

    async function pull() {
      try {
        const url = new URL(`/api/checkin/${surveyId}`, window.location.origin);
        if (cursor) url.searchParams.set('depuis', cursor);
        const response = await fetch(url, { headers: { accept: 'application/json' } });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { states: CheckinState[]; at: string };
        if (cancelled) return;
        dispatch({ type: 'delta', states: body.states, at: Date.parse(body.at) });
      } catch {
        /* Le réseau a hoqueté. La fraîcheur affichée dira d'elle-même que la
           liste vieillit — c'est exactement ce qu'on lui demande, et bien mieux
           qu'un message d'erreur qui s'empilerait toutes les cinq secondes. */
      }
    }

    // En répétition l'écran est entièrement local : un delta réécrirait les
    // pointages d'entraînement avec l'état réel, et l'exercice n'aurait plus
    // de sens.
    if (rehearsal) return;

    void pull();
    const timer = window.setInterval(() => void pull(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [surveyId, cursor, rehearsal]);

  // --- Vidage de la file, une opération à la fois ----------------------------
  const sending = useRef(false);
  useEffect(() => {
    if (rehearsal) return;
    const op = nextOp(state);
    if (!op || sending.current) return;

    sending.current = true;
    const expectedVersion = expectedVersionOf(state, op.responseId);
    dispatch({ type: 'sending', opId: op.opId });

    let timer: number | null = null;

    void (async () => {
      try {
        const response = await fetch(`/api/checkin/${surveyId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            responseId: op.responseId,
            arrived: op.arrived,
            opId: op.opId,
            expectedVersion,
            peopleIn: op.peopleIn,
          }),
        });

        if (response.ok) {
          const applied = (await response.json().catch(() => null)) as CheckinState | null;

          /*
           * Un `200` ne suffit pas : le portail captif d'une salle de réception
           * répond `200` à TOUT, avec sa page de connexion. Sans ce contrôle,
           * la rangée quitterait la file sur une réponse qui ne dit rien, et
           * l'arrivée serait perdue en silence — exactement la panne que la
           * file existe pour couvrir. On vérifie donc que la réponse parle bien
           * de CETTE rangée, et on réessaie sinon.
           */
          if (applied && applied.responseId === op.responseId) {
            dispatch({ type: 'applied', opId: op.opId, state: applied });
            return;
          }

          timer = window.setTimeout(
            () => dispatch({ type: 'retry', opId: op.opId }),
            retryDelay(op.attempts + 1),
          );
          return;
        }

        const body = (await response.json().catch(() => null)) as
          | { error?: { code?: string } }
          | null;
        const code = body?.error?.code;

        /* Un refus MÉTIER est définitif : le redire au serveur donnerait le
           même refus. Une panne de transport, elle, se réessaie. Confondre les
           deux ferait boucler l'écran sur un « non » qui ne changera pas. */
        if (code === 'conflict' || code === 'forbidden' || code === 'not_found') {
          dispatch({
            type: 'refused',
            opId: op.opId,
            message: checkinErrorMessage(code),
          });
          return;
        }

        timer = window.setTimeout(
          () => dispatch({ type: 'retry', opId: op.opId }),
          retryDelay(op.attempts + 1),
        );
      } catch {
        // Réseau coupé : on repose l'opération et on réessaiera.
        timer = window.setTimeout(
          () => dispatch({ type: 'retry', opId: op.opId }),
          retryDelay(op.attempts + 1),
        );
      } finally {
        sending.current = false;
      }
    })();

    return () => {
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [state, surveyId, rehearsal]);

  const toggle = useCallback(
    (row: DeskRow) => {
      const arrived = !row.arrived;
      const opId = crypto.randomUUID();
      dispatch({
        type: 'tap',
        opId,
        responseId: row.id,
        arrived,
        // On n'invente aucun effectif : non précisé reste non précisé, et le
        // compteur de salle retient l'effectif ANNONCÉ en le disant.
        peopleIn: null,
      });

      if (rehearsal) {
        // Appliqué sur-le-champ, en local. Laisser l'opération en file
        // afficherait « envoi en cours » pour toujours, sur un envoi qui
        // n'aura jamais lieu.
        dispatch({
          type: 'applied',
          opId,
          state: {
            responseId: row.id,
            arrivedAt: arrived ? new Date().toISOString() : null,
            peopleIn: null,
            version: (row.pending ? 0 : 1) + 1,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      setAnnouncement(
        `${row.name ?? 'Réponse'} — ${arrived ? 'arrivé' : 'retiré des arrivées'}`,
      );
    },
    [rehearsal],
  );

  const fresh = freshness(state.syncedAt, tick, online);
  const { totals } = list;

  return (
    <div className={`sp-desk${rehearsal ? ' sp-desk--rehearsal' : ''}`}>
      {rehearsal ? (
        <p className="sp-desk__rehearsal">
          <strong>Essai à blanc.</strong> Rien n’est enregistré ni compté :
          entraînez-vous librement, rechargez la page pour tout remettre à zéro.
          Le fait d’avoir ouvert cet écran prouve déjà que votre compte
          fonctionne.
        </p>
      ) : null}
      <header className="sp-desk__head">
        <p className="sp-desk__title">{title}</p>
        <p className="sp-desk__count">
          <strong>{totals.inRoom}</strong>
          <span>
            {totals.inRoom > 1 ? 'personnes présentes' : 'personne présente'}
            {counting ? ` sur ${totals.expectedPeople} attendues` : ''}
          </span>
        </p>
        {rehearsal ? null : (
          <p className={`sp-desk__fresh sp-desk__fresh--${fresh.tone}`}>{fresh.text}</p>
        )}
        {totals.pending > 0 ? (
          <p className="sp-desk__pending">
            {totals.pending} pointage{totals.pending > 1 ? 's' : ''} en attente d’envoi
          </p>
        ) : null}
      </header>

      {/* UNE zone d'annonce, et une seule, pour tout l'écran. */}
      <p aria-live="polite" className="sp-visually-hidden" role="status">
        {announcement}
      </p>

      <div className="sp-desk__tools">
        <label className="sp-visually-hidden" htmlFor="sp-desk-search">
          Rechercher un invité
        </label>
        <input
          autoComplete="off"
          className="sp-input"
          id="sp-desk-search"
          inputMode="search"
          maxLength={60}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Rechercher un nom…"
          type="search"
          value={search}
        />
        <nav aria-label="Filtrer la liste" className="sp-chips">
          {(['all', 'awaited', 'arrived'] as const).map((key) => (
            <button
              aria-pressed={filter === key}
              className="sp-chip sp-chip--btn"
              key={key}
              onClick={() => setFilter(key)}
              type="button"
            >
              {FILTER_LABELS[key]}
              <span className="sp-chip__count">
                {key === 'all'
                  ? list.rows.length
                  : key === 'arrived'
                    ? totals.arrived
                    : list.rows.length - totals.arrived}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {visible.length === 0 ? (
        <p className="sp-desk__empty">
          {search
            ? `Aucun invité ne correspond à « ${search} ».`
            : 'Aucun invité dans ce filtre.'}
        </p>
      ) : (
        <ul className="sp-desk__list">
          {visible.map((row) => (
            <li
              className={`sp-desk__row${row.arrived ? ' sp-desk__row--in' : ''}${
                row.pending ? ' sp-desk__row--sending' : ''
              }`}
              key={row.id}
            >
              <button
                className="sp-desk__toggle"
                onClick={() => toggle(row)}
                type="button"
              >
                <span aria-hidden="true" className="sp-desk__avatar">
                  {row.initials || '·'}
                </span>
                <span className="sp-desk__who">
                  <span className="sp-desk__name">{row.name ?? 'Réponse sans nom'}</span>
                  <span className="sp-desk__meta">
                    {[
                      row.detail,
                      row.announced > 1 ? `${row.announced} personnes annoncées` : null,
                      row.ambiguous ? 'effectif à vérifier' : null,
                    ]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ')}
                  </span>
                </span>
                {/* Le statut est ÉCRIT. La couleur de la rangée le renforce. */}
                <span className="sp-desk__status">{deskStatusLabel(row)}</span>
              </button>

              {row.refused ? (
                <p className="sp-desk__refused">
                  <span>{row.refused.message}</span>
                  <button
                    className="sp-btn sp-btn--ghost"
                    onClick={() => dispatch({ type: 'dismiss', opId: row.refused!.opId })}
                    type="button"
                  >
                    J’ai lu
                  </button>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <footer className="sp-desk__foot">
        <a className="sp-btn sp-btn--ghost" href={printHref}>
          Liste de secours à imprimer
        </a>
        <span className="sp-muted">
          {totals.arrived} arrivé{totals.arrived > 1 ? 's' : ''} sur {list.rows.length}
        </span>
      </footer>
    </div>
  );
}
