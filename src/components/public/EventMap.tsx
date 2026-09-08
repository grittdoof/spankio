'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap } from 'leaflet';
// Feuille de style de Leaflet. Importée statiquement — un import de CSS ne peut
// pas être dynamique — alors que le MODULE, lui, est chargé dans un effet.
import 'leaflet/dist/leaflet.css';

/**
 * Carte de localisation d'un événement, sur la page publique.
 *
 * Quatre partis pris, dont le premier est une contrepartie assumée.
 *
 *  1. **Les tuiles partent du navigateur de l'invité vers OpenStreetMap.** Ce
 *     bloc est donc le seul de l'invitation qui contacte un tiers sans clic, et
 *     c'est pourquoi il est débrayable comme les autres : l'écran de réglages
 *     le dit. La politique d'usage d'OSM vise les usages modérés — une
 *     invitation lue par quelques centaines de personnes y entre, une page
 *     vue par centaines de milliers non.
 *  2. **La carte est un REPÈRE, pas un outil.** Ni glissement, ni zoom, ni
 *     clavier : elle porte `role="img"` et une description, et ce sont les
 *     liens d'itinéraire — déjà présents — qui font le travail interactif.
 *     Promettre une interaction qu'on ne fournit pas est pire que s'en
 *     abstenir.
 *  3. **Leaflet est chargé dynamiquement dans un effet.** Ses modules touchent
 *     `window` à l'import : un import statique casse le rendu serveur. Et si
 *     le chargement échoue, la carte n'apparaît simplement pas — l'adresse et
 *     les liens restent.
 *  4. **Un seul `remove()` au démontage.** Le premier appel efface
 *     `container._leaflet_id` ; un second lève « Map container is being reused
 *     by another instance », ce qui produisait une page blanche au retour.
 */

export interface EventMapProps {
  latitude: number;
  longitude: number;
  /** Nom du lieu, pour la description de la carte. */
  label: string | null;
}

export function EventMap({ latitude, longitude, label }: EventMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    const start = async () => {
      const leaflet = await import('leaflet');

      // Le conteneur est relu APRÈS l'attente : entre le début de l'import et
      // sa résolution, React peut avoir démonté le composant.
      const container = containerRef.current;
      if (cancelled || !container) return;

      map = leaflet
        .map(container, {
          attributionControl: true,
          boxZoom: false,
          doubleClickZoom: false,
          dragging: false,
          keyboard: false,
          scrollWheelZoom: false,
          touchZoom: false,
          zoomControl: false,
        })
        .setView([latitude, longitude], 16);

      // Attribution obligatoire : c'est la contrepartie de tuiles gratuites.
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; les contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(map);

      leaflet
        .marker([latitude, longitude], {
          icon: leaflet.divIcon({
            className: 'sp-map-marker',
            iconSize: [22, 22],
            iconAnchor: [11, 11],
            html: '<span aria-hidden="true"></span>',
          }),
          keyboard: false,
        })
        .addTo(map);

      mapRef.current = map;
      setReady(true);
    };

    void start();

    return () => {
      cancelled = true;
      const instance = mapRef.current ?? map;
      mapRef.current = null;
      map = null;
      instance?.remove();
    };
  }, [latitude, longitude]);

  return (
    <div
      aria-label={
        label
          ? `Carte de localisation : ${label}`
          : 'Carte de localisation du lieu de l’événement'
      }
      className={`sp-invite__map${ready ? '' : ' sp-invite__map--loading'}`}
      ref={containerRef}
      role="img"
    />
  );
}
