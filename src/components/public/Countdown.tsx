'use client';

import { useEffect, useState } from 'react';
import { countdownParts, type CountdownParts } from '@/lib/event/countdown';

/**
 * Compte à rebours avant l'événement.
 *
 * Trois précautions, toutes conséquences du fait qu'un compteur bouge :
 *
 *  1. **La première valeur vient du SERVEUR.** Elle est passée en propriété et
 *     sert d'état initial : le premier rendu du navigateur produit exactement
 *     le même HTML, donc aucune divergence d'hydratation. Calculer
 *     `Date.now()` au montage aurait donné une seconde d'écart et un
 *     avertissement React à chaque chargement.
 *  2. **Rien n'est annoncé à chaque seconde.** Les chiffres sont
 *     `aria-hidden`, et la phrase écrite à côté n'est PAS une zone live : elle
 *     se lit quand on l'atteint. Un `aria-live` sur un compteur de secondes
 *     rendrait la page inutilisable au lecteur d'écran.
 *  3. **L'intervalle est nettoyé au démontage**, et s'arrête de lui-même une
 *     fois l'échéance atteinte — un `setInterval` qui survit au démontage
 *     appelle `setState` sur un composant disparu.
 */

export function Countdown({
  startsAt,
  initial,
}: {
  startsAt: string;
  /** Décompte calculé côté serveur, au rendu de la page. */
  initial: CountdownParts;
}) {
  const [parts, setParts] = useState<CountdownParts>(initial);

  useEffect(() => {
    if (parts.reached) return;
    const timer = setInterval(() => {
      const next = countdownParts(startsAt, new Date());
      if (next) setParts(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [startsAt, parts.reached]);

  if (parts.reached) return null;

  const cells: readonly { readonly value: number; readonly unit: string }[] = [
    { value: parts.days, unit: parts.days === 1 ? 'jour' : 'jours' },
    { value: parts.hours, unit: 'heures' },
    { value: parts.minutes, unit: 'minutes' },
    { value: parts.seconds, unit: 'sec.' },
  ];

  return (
    <section className="sp-card sp-countdown">
      <h2 className="sp-countdown__label">Ouverture des portes dans</h2>
      <p aria-hidden="true" className="sp-countdown__cells">
        {cells.map((cell, index) => (
          <span
            className={`sp-countdown__cell${index === cells.length - 1 ? ' sp-countdown__cell--last' : ''}`}
            key={cell.unit}
          >
            <span className="sp-countdown__value">{String(cell.value).padStart(2, '0')}</span>
            <span className="sp-countdown__unit">{cell.unit}</span>
          </span>
        ))}
      </p>
      {/* La même information, en une phrase, sans les secondes. */}
      <p className="sp-visually-hidden">{parts.label}</p>
    </section>
  );
}
