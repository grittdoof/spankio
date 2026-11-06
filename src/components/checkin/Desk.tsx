'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  cursorOf,
  deskReducer,
  indexStates,
  expectedVersionOf,
  nextOp,
  retryDelay,
  EMPTY_DESK,
  type CheckinKind,
  type CheckinState,
  type DeskState,
} from '@/lib/checkin/reducer';
import { deskList, deskStatusLabel, giftStatusLabel, type DeskRow } from '@/lib/checkin/rows';
import {
  DESK_ORDERS,
  expandSeats,
  parseDeskOrder,
  seatKey,
  sortGuests,
  type DeskOrder,
} from '@/lib/checkin/seats';
import { DESK_MODES, deskModeHref, type DeskMode } from '@/lib/checkin/mode';
import { viewportMetrics } from '@/lib/checkin/viewport';
import {
  mergeGuests,
  rehearsalGuest,
  walkinData,
  type WalkinField,
} from '@/lib/checkin/walkin';
import { WalkinSheet, type WalkinStatus } from './WalkinSheet';
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
  /** Logo de l'organisation, s'il en a déposé un. */
  readonly logoUrl?: string | null;
  readonly organisationName?: string | null;
  /**
   * Essai à blanc : les hôtesses s'entraînent, RIEN n'est envoyé ni compté, et
   * un rechargement remet à zéro. Le classique « on a découvert à 19 h 50 que
   * le compte ne marchait pas » disparaît, puisqu'ouvrir cet écran prouve déjà
   * que le compte fonctionne.
   */
  readonly rehearsal?: boolean;
  /**
   * Les questions posées pour un invité de dernière minute — celles qui
   * nomment et précisent une rangée. Vide : l'ajout explique pourquoi il
   * n'est pas possible au lieu de disparaître.
   */
  readonly walkinFields?: readonly WalkinField[];
  /** Mode au chargement, lu dans l'URL : un rechargement ne doit pas en changer. */
  readonly initialMode?: DeskMode;
}

type Filter = 'all' | 'awaited' | 'arrived';

const FILTER_LABELS: Readonly<Record<DeskMode, Readonly<Record<Filter, string>>>> = {
  arrivals: { all: 'Tous', awaited: 'À venir', arrived: 'Arrivés' },
  // Courts : les trois puces tiennent sur une ligne à 375 px, comme à l'entrée.
  departures: { all: 'Tous', awaited: 'À offrir', arrived: 'Remis' },
};

/** Ce qu'un appui signifie, selon le mode : c'est la ligne la plus lue du poste. */
const MODE_NOTES: Readonly<Record<DeskMode, string>> = {
  arrivals: 'Un appui sur une rangée pointe l’arrivée.',
  departures: 'Mode départs : un appui sur une rangée enregistre la remise du cadeau.',
};

/**
 * L'état de départ, rendu par le SERVEUR : la liste est complète avant tout
 * JavaScript, arrivées comprises.
 *
 * L'indexation passe par `indexStates`, la même que le réducteur. Elle était
 * recopiée ici, et la copie indexait par `responseId` seul : les arrivées
 * déjà enregistrées disparaissaient au rechargement, et le premier appui
 * annonçait une version périmée.
 *
 * `syncedAt` reste NUL, délibérément : écrire ici un `Date.now()` ferait
 * différer le rendu serveur du premier rendu client d'une seconde, et React
 * signalerait une divergence d'hydratation. La fraîcheur se dira au premier
 * delta, qui part dès le montage.
 */
function initial(props: DeskProps): DeskState {
  return {
    ...EMPTY_DESK,
    states: indexStates(props.initialStates),
    cursor: cursorOf(null, props.initialStates),
  };
}

export function Desk(props: DeskProps) {
  const {
    surveyId,
    guests,
    counting,
    printHref,
    title,
    logoUrl = null,
    organisationName = null,
    rehearsal = false,
    walkinFields = [],
    initialMode = 'arrivals',
  } = props;
  const [state, dispatch] = useReducer(deskReducer, props, initial);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [mode, setMode] = useState<DeskMode>(initialMode);
  /* Personnes ajoutées à l'entrée depuis le chargement — ici ou ailleurs. */
  const [extraGuests, setExtraGuests] = useState<readonly GuestRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [walkinStatus, setWalkinStatus] = useState<WalkinStatus>({ kind: 'idle' });
  /* L'opération d'ajout en cours. Gardée tant qu'elle n'a pas abouti : un
     réessai après coupure doit porter le MÊME identifiant, sans quoi il
     créerait un homonyme. */
  const walkinOp = useRef<string | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  /* Alphabétique par défaut : à une porte, on cherche un nom. */
  const [order, setOrder] = useState<DeskOrder>('name');
  const [online, setOnline] = useState(true);
  const [announcement, setAnnouncement] = useState('');
  /* Horloge du rendu : la fraîcheur se recalcule même sans nouvel événement,
     sinon « à jour il y a 3 s » resterait affiché pendant deux minutes. */
  const [tick, setTick] = useState(() => Date.now());

  // Les inscriptions sont dépliées en PERSONNES avant toute chose : le poste
  // ne manipule plus que des sièges, et le compteur de salle en découle.
  // Classement PUIS dépliage : l'hôte et son accompagnant restent côte à côte.
  const allGuests = useMemo(() => mergeGuests(guests, extraGuests), [guests, extraGuests]);
  const seats = useMemo(() => expandSeats(sortGuests(allGuests, order)), [allGuests, order]);
  const list = useMemo(() => deskList(seats, state), [seats, state]);

  const visible = useMemo(() => {
    const needle = normaliseSearch(search);
    return list.rows.filter((row) => {
      // Le filtre suit le MODE : à la sortie, « fait » veut dire « cadeau remis ».
      const done = mode === 'departures' ? row.gift : row.arrived;
      if (filter === 'arrived' && !done) return false;
      if (filter === 'awaited' && done) return false;
      if (needle === '') return true;
      const haystack = normaliseSearch(`${row.name ?? ''} ${row.detail ?? ''}`);
      return haystack.includes(needle);
    });
  }, [list.rows, search, filter, mode]);

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
        seat: op.seat,
        kind: op.kind,
        value: op.value,
      });
    }
  }, [surveyId, rehearsal]);

  useEffect(() => {
    if (rehearsal) return;
    saveQueue(surveyId, state.queue);
  }, [surveyId, state.queue, rehearsal]);

  // --- La barre du bas suit la zone VISIBLE, clavier compris ----------------
  // Sur iPhone, le clavier se pose PAR-DESSUS la page sans la rétrécir : une
  // barre accrochée au bas de la page resterait derrière lui, ou laisserait
  // voir une bande de liste entre elle et le clavier. Elle est donc relevée
  // de ce que le clavier recouvre, et repositionnée à chaque défilement.
  // Écrit directement sur l'élément, hors de React : à chaque image de
  // défilement, un rendu entier de deux cents rangées ferait saccader.
  useEffect(() => {
    const viewport = window.visualViewport;
    const element = dock.current;
    if (!viewport || !element) return;

    let frame = 0;
    const apply = () => {
      frame = 0;
      const metrics = viewportMetrics({
        innerHeight: window.innerHeight,
        height: viewport.height,
        offsetTop: viewport.offsetTop,
      });
      element.style.setProperty('--sp-dock-lift', `${metrics.lift}px`);
      element.style.setProperty('--sp-vv-top', `${metrics.top}px`);
      element.style.setProperty('--sp-vv-height', `${metrics.height}px`);
      element.dataset['keyboard'] = metrics.keyboard ? 'true' : 'false';
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };

    apply();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
      window.removeEventListener('scroll', schedule);
    };
  }, []);

  // --- L'ajout fige la page ---------------------------------------------------
  // Le formulaire d'ajout couvre tout l'écran : on ne doit ni voir ni faire
  // défiler la liste derrière. Bloquer le défilement de la page empêche aussi
  // Safari de la faire glisser sous le panneau quand le clavier s'ouvre.
  useEffect(() => {
    if (!adding) return;
    const root = document.documentElement;
    const body = document.body;
    const previous = [root.style.overflow, body.style.overflow];
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous[0] ?? '';
      body.style.overflow = previous[1] ?? '';
    };
  }, [adding]);

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
        const body = (await response.json()) as {
          states: CheckinState[];
          guests?: GuestRow[];
          at: string;
        };
        if (cancelled) return;
        // Les personnes ajoutées sur un autre poste d'abord : sinon leur
        // arrivée serait comptée une seconde avant d'avoir une rangée.
        if (body.guests && body.guests.length > 0) {
          const incoming = body.guests;
          setExtraGuests((current) => mergeGuests(current, incoming));
        }
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
    const expectedVersion = expectedVersionOf(state, op.responseId, op.seat);
    dispatch({ type: 'sending', opId: op.opId });

    let timer: number | null = null;

    void (async () => {
      try {
        const response = await fetch(`/api/checkin/${surveyId}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            responseId: op.responseId,
            seat: op.seat,
            // `arrived` porte la VALEUR du geste ; le nom est gardé pour que
            // la route continue de comprendre un poste plus ancien.
            arrived: op.value,
            kind: op.kind,
            opId: op.opId,
            expectedVersion,
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
          if (
            applied &&
            applied.responseId === op.responseId &&
            applied.seat === op.seat
          ) {
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
      // Le MODE décide du geste : à l'entrée on pointe l'arrivée, à la sortie
      // le cadeau. Aucune rangée ne porte deux boutons — viser le bon, debout,
      // d'une main, serait une source d'erreur bien pire qu'un mode affiché.
      const kind: CheckinKind = mode === 'departures' ? 'gift' : 'arrival';
      const value = kind === 'gift' ? !row.gift : !row.arrived;
      const opId = crypto.randomUUID();
      dispatch({
        type: 'tap',
        opId,
        responseId: row.responseId,
        seat: row.seat,
        kind,
        value,
      });

      if (rehearsal) {
        // Appliqué sur-le-champ, en local. Laisser l'opération en file
        // afficherait « envoi en cours » pour toujours, sur un envoi qui
        // n'aura jamais lieu. L'autre colonne est GARDÉE : remettre un cadeau
        // ne doit pas effacer l'arrivée pointée un peu plus tôt.
        const known = state.states[seatKey(row.responseId, row.seat)];
        const now = new Date().toISOString();
        dispatch({
          type: 'applied',
          opId,
          state: {
            responseId: row.responseId,
            seat: row.seat,
            arrivedAt:
              kind === 'arrival' ? (value ? now : null) : (known?.arrivedAt ?? null),
            giftAt: kind === 'gift' ? (value ? now : null) : (known?.giftAt ?? null),
            version: (known?.version ?? 0) + 1,
            updatedAt: now,
          },
        });
      }
      const who = row.name ?? 'Réponse';
      setAnnouncement(
        kind === 'gift'
          ? `${who} — ${value ? 'cadeau remis' : 'cadeau retiré'}`
          : `${who} — ${value ? 'arrivé' : 'retiré des arrivées'}`,
      );
    },
    [rehearsal, mode, state.states],
  );

  /**
   * Change de mode, et l'ÉCRIT dans l'URL.
   *
   * Une hôtesse passée à la sortie qui recharge sa page doit y rester : un
   * retour silencieux au mode « Arrivées » transformerait ses appuis suivants
   * en dé-pointages, sur des gens qui sont en train de partir.
   */
  const switchMode = useCallback(
    (next: DeskMode) => {
      setMode(next);
      setFilter('all');
      setAnnouncement(MODE_NOTES[next]);
      try {
        window.history.replaceState(
          null,
          '',
          deskModeHref(window.location.pathname, window.location.search, next),
        );
      } catch {
        /* Un navigateur qui refuse l'écriture de l'historique garde le mode
           en mémoire : le poste continue, il ne survivra simplement pas à un
           rechargement. */
      }
    },
    [],
  );

  const closeWalkin = useCallback(() => {
    setAdding(false);
    setWalkinStatus({ kind: 'idle' });
    // Le focus revient au bouton qui a ouvert : sans cela, il tomberait en
    // haut de page, à deux cents rangées du pouce.
    window.requestAnimationFrame(() => addButton.current?.focus());
  }, []);

  const submitWalkin = useCallback(
    async (values: Readonly<Record<string, string>>): Promise<boolean> => {
      const built = walkinData(walkinFields, values);
      if (!built.ok) {
        setWalkinStatus({ kind: 'error', message: built.message });
        return false;
      }

      const opId = walkinOp.current ?? crypto.randomUUID();
      walkinOp.current = opId;
      setWalkinStatus({ kind: 'sending' });

      let guest: GuestRow;
      let applied: CheckinState;

      if (rehearsal) {
        // Rien ne part : la rangée et son arrivée n'existent que sur cet écran.
        const now = new Date().toISOString();
        guest = rehearsalGuest(opId, walkinFields, built.data, now);
        applied = {
          responseId: opId,
          seat: 0,
          arrivedAt: now,
          giftAt: null,
          version: 1,
          updatedAt: now,
        };
      } else {
        try {
          const response = await fetch(`/api/checkin/${surveyId}/invite`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ opId, values: built.data }),
          });
          const body = (await response.json().catch(() => null)) as
            | { guest?: GuestRow; state?: CheckinState; error?: { message?: string } }
            | null;

          // Même méfiance qu'au pointage : un portail captif répond `200` à
          // tout. Sans rangée ni état cohérents, rien n'est tenu pour fait.
          if (
            !response.ok ||
            !body?.guest ||
            !body.state ||
            body.state.responseId !== body.guest.id
          ) {
            setWalkinStatus({
              kind: 'error',
              message:
                response.status === 400 && body?.error?.message
                  ? body.error.message
                  : 'La personne n’a pas été ajoutée. Réessayez — ou notez-la sur la liste papier si le réseau ne revient pas.',
            });
            return false;
          }
          guest = body.guest;
          applied = body.state;
        } catch {
          setWalkinStatus({
            kind: 'error',
            message:
              'Pas de réseau : la personne n’a pas été ajoutée. Réessayez dans un instant — rien ne sera créé en double.',
          });
          return false;
        }
      }

      walkinOp.current = null;
      setExtraGuests((current) => mergeGuests(current, [guest]));
      dispatch({ type: 'applied', opId, state: applied });
      setAnnouncement(`${guest.name ?? 'Invité'} — ajouté et pointé arrivé`);
      setSearch('');
      closeWalkin();
      return true;
    },
    [walkinFields, rehearsal, surveyId, closeWalkin],
  );

  const fresh = freshness(state.syncedAt, tick, online);
  const { totals } = list;
  const done = mode === 'departures' ? totals.gifts : totals.inRoom;

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
        {/* L'imprimante vivait dans le pied de page, SOUS la liste entière :
            sur cent cinquante rangées, personne n'y descend jamais. Elle est
            donc en tête, discrète — une icône, pas un bouton qui dispute la
            place au compteur — et toujours atteignable. Elle ouvre un onglet
            à part pour ne pas quitter le poste en plein service. */}
        <a
          className="sp-desk__print"
          href={printHref}
          rel="noopener"
          target="_blank"
        >
          <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
            <path
              d="M7 9V4h10v5M7 19H6a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-1M7 15h10v5H7v-5Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
          <span className="sp-visually-hidden">Imprimer la liste de secours</span>
        </a>
        {/* Le logo est DÉCORATIF : le titre de l'événement est juste à côté,
            et le nom de l'organisation avec lui. L'entendre deux fois
            n'apprendrait rien. Seule la HAUTEUR est contrainte — un logo est
            presque toujours plus large que haut, et l'enfermer dans un carré
            le réduirait à un timbre. */}
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="sp-desk__logo" decoding="async" src={logoUrl} />
        ) : null}
        <p className="sp-desk__title">
          {title}
          {organisationName ? (
            <span className="sp-desk__org">{organisationName}</span>
          ) : null}
        </p>
        {mode === 'departures' ? (
          <p className="sp-desk__count">
            <strong>{totals.gifts}</strong>
            <span>
              {totals.gifts > 1 ? 'cadeaux remis' : 'cadeau remis'} · {totals.inRoom}{' '}
              {totals.inRoom > 1 ? 'personnes pointées' : 'personne pointée'}
            </span>
          </p>
        ) : (
          <p className="sp-desk__count">
            <strong>{totals.inRoom}</strong>
            <span>
              {totals.inRoom > 1 ? 'personnes présentes' : 'personne présente'}
              {counting ? ` sur ${totals.expectedPeople} attendues` : ''}
            </span>
          </p>
        )}
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
        {/* Le mode : deux boutons à bascule, pas des onglets. Un
            `role="tablist"` promettrait une navigation par flèches que deux
            boutons ne fournissent pas — même raisonnement que les vues des
            statistiques. */}
        <div aria-label="Ce que pointe un appui" className="sp-desk__modes" role="group">
          {DESK_MODES.map((option) => (
            <button
              aria-pressed={mode === option.value}
              className="sp-desk__mode"
              key={option.value}
              onClick={() => switchMode(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className={`sp-desk__note sp-desk__note--${mode}`}>{MODE_NOTES[mode]}</p>

        {/* Le classement est un vrai `select` natif, comme partout : au doigt,
            debout, une liste déroulante du système bat n'importe quel menu
            dessiné à la main. */}
        <label className="sp-visually-hidden" htmlFor="sp-desk-order">
          Classer la liste
        </label>
        <select
          className="sp-select sp-desk__order"
          id="sp-desk-order"
          onChange={(event) => setOrder(parseDeskOrder(event.target.value))}
          value={order}
        >
          {DESK_ORDERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <nav aria-label="Filtrer la liste" className="sp-chips">
          {(['all', 'awaited', 'arrived'] as const).map((key) => (
            <button
              aria-pressed={filter === key}
              className="sp-chip sp-chip--btn"
              key={key}
              onClick={() => setFilter(key)}
              type="button"
            >
              {FILTER_LABELS[mode][key]}
              <span className="sp-chip__count">
                {key === 'all'
                  ? list.rows.length
                  : key === 'arrived'
                    ? done
                    : list.rows.length - done}
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
              className={`sp-desk__row${
                (mode === 'departures' ? row.gift : row.arrived) ? ' sp-desk__row--in' : ''
              }${(mode === 'departures' ? row.giftPending : row.pending) ? ' sp-desk__row--sending' : ''}${
                row.isCompanion ? ' sp-desk__row--companion' : ''
              }`}
              key={row.key}
            >
              <button
                className="sp-desk__toggle"
                onClick={() => toggle(row)}
                type="button"
              >
                {/* Une teinte de pastille ne suffisait pas à faire
                    comprendre d'un coup d'œil qu'il s'agit d'un
                    accompagnant : la rangée porte donc un bandeau vertical
                    qui le NOMME, et son contenu est décalé vers la droite —
                    le décalage se lit même sans couleur.

                    Le bandeau est `aria-hidden` : la rangée dit déjà
                    « accompagnant(e) de … » dans sa précision, et l'entendre
                    deux fois n'apprendrait rien. Même règle que le compte
                    inscrit au-dessus d'une colonne de graphique. */}
                {row.isCompanion ? (
                  <span aria-hidden="true" className="sp-desk__flag">
                    accompagnant
                  </span>
                ) : (
                  <span aria-hidden="true" className="sp-desk__avatar">
                    {row.initials || '·'}
                  </span>
                )}
                <span className="sp-desk__who">
                  <span className="sp-desk__name">{row.name ?? 'Réponse sans nom'}</span>
                  {/* Une ligne par personne : il n'y a plus d'effectif à
                      afficher ni à vérifier sur la rangée — le compteur de
                      salle est le nombre de sièges pointés. Ne reste que la
                      précision : société pour l'inscrit, « accompagnant(e)
                      de X » pour celui qu'il amène. */}
                  <span className="sp-desk__meta">
                    {[
                      row.detail,
                      // Écrit, comme le reste : sans cette mention, on lirait
                      // une inscription dont la présence n'a pas été dite.
                      row.walkIn && !row.isCompanion ? 'ajouté à l’entrée' : null,
                      row.ambiguous ? 'nombre d’accompagnants à vérifier' : null,
                      // À la sortie, on voit aussi qui la porte a OUBLIÉ.
                      mode === 'departures' && !row.arrived ? 'non pointé à l’entrée' : null,
                    ]
                      .filter((part): part is string => Boolean(part))
                      .join(' · ')}
                  </span>
                </span>
                {/* Le statut est ÉCRIT. La couleur de la rangée le renforce. */}
                <span className="sp-desk__status">
                  {mode === 'departures' ? giftStatusLabel(row) : deskStatusLabel(row)}
                </span>
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
        <span className="sp-muted">
          {mode === 'departures'
            ? `${totals.gifts} cadeau${totals.gifts > 1 ? 'x' : ''} remis sur ${list.rows.length}`
            : `${totals.inRoom} arrivé${totals.inRoom > 1 ? 's' : ''} sur ${list.rows.length}`}
        </span>
      </footer>

      {/* La barre du bas : la recherche ET l'ajout, sous le pouce.
          C'était la demande, et elle tient : debout, téléphone dans une
          main, le haut de l'écran est hors de portée — on y allait pourtant
          à chaque invité. C'est la SEULE barre fixée de l'écran : deux
          barres collantes mangeraient un tiers de la hauteur utile d'un
          téléphone, la règle déjà posée pour le parcours public. */}
      <div
        className={`sp-desk__dock${adding ? ' sp-desk__dock--open' : ''}`}
        data-keyboard="false"
        ref={dock}
      >
        {adding ? (
          <WalkinSheet
            fields={walkinFields}
            id="sp-desk-walkin"
            onCancel={closeWalkin}
            onSubmit={submitWalkin}
            rehearsal={rehearsal}
            status={walkinStatus}
          />
        ) : null}
        <div className="sp-desk__dockbar">
          {/* Pendant un ajout, la recherche s'efface : elle filtrerait une
              liste qu'on ne voit plus, et deux champs sous le pouce invitent
              à taper dans le mauvais. Sa saisie, elle, est gardée. */}
          {adding ? null : (
            <>
              <label className="sp-visually-hidden" htmlFor="sp-desk-search">
                Rechercher un invité
              </label>
              <input
                autoComplete="off"
                className="sp-input sp-desk__search"
                enterKeyHint="search"
                id="sp-desk-search"
                inputMode="search"
                maxLength={60}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Rechercher un nom…"
                type="search"
                value={search}
              />
            </>
          )}
          <button
            aria-controls="sp-desk-walkin"
            aria-expanded={adding}
            className="sp-desk__add"
            onClick={() => (adding ? closeWalkin() : setAdding(true))}
            ref={addButton}
            type="button"
          >
            <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.4"
              />
            </svg>
            <span className="sp-visually-hidden">Ajouter un invité de dernière minute</span>
          </button>
        </div>
      </div>
    </div>
  );
}
