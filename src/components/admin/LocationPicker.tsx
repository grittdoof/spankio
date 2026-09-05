'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker } from 'leaflet';
// Feuille de style de Leaflet. Importée statiquement — un import de CSS ne peut
// pas être dynamique — alors que le MODULE, lui, est chargé dans un effet.
import 'leaflet/dist/leaflet.css';
import { Field } from '@/components/ui/Field';
import {
  isValidLatitude,
  isValidLongitude,
  roundCoordinate,
  type GeocodeResult,
} from '@/lib/event/geocode';

/**
 * Choix d'un lieu : recherche d'adresse, carte OpenStreetMap, marqueur
 * déplaçable.
 *
 * Quatre partis pris :
 *
 *  1. **La carte est un CONFORT, jamais le seul chemin.** La recherche
 *     d'adresse et deux champs numériques suffisent à régler un lieu au
 *     clavier. Une carte glissable est par nature inutilisable au lecteur
 *     d'écran ; en faire le seul moyen rendrait la fonction inaccessible.
 *  2. **Leaflet est chargé dynamiquement dans un effet.** Ses modules touchent
 *     `window` à l'import : un import statique casse le rendu serveur.
 *  3. **Aucune iframe.** Les tuiles sont chargées par Leaflet ; intégrer
 *     openstreetmap.org dans une iframe serait bloqué par la politique de
 *     sécurité de contenu, et exposerait le visiteur à un tiers.
 *  4. **Le marqueur utilise un `divIcon`**, dessiné en CSS. Les icônes par
 *     défaut de Leaflet sont des fichiers image dont le chemin se perd au
 *     bundling — et une image de moins est une origine de moins à autoriser.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface LocationPickerProps {
  value: LatLng | null;
  onChange: (value: LatLng | null) => void;
  /** Appelé quand une adresse est choisie dans les résultats de recherche. */
  onAddressPicked?: (label: string) => void;
}

/** Centre par défaut quand aucun point n'est encore choisi : l'Europe. */
const DEFAULT_CENTER: LatLng = { latitude: 48.8566, longitude: 2.3522 };

const SEARCH_DEBOUNCE_MS = 700;

export function LocationPicker({ value, onChange, onAddressPicked }: LocationPickerProps) {
  const baseId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  // --- Carte --------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;

    const start = async () => {
      const container = containerRef.current;
      if (!container) return;

      // Import dynamique : les modules de Leaflet touchent `window` dès leur
      // évaluation, ce qui ferait échouer le rendu serveur.
      const leaflet = await import('leaflet');
      if (cancelled || !containerRef.current) return;

      const center = value ?? DEFAULT_CENTER;
      map = leaflet.map(container, { scrollWheelZoom: false }).setView(
        [center.latitude, center.longitude],
        value ? 16 : 5,
      );

      // Attribution obligatoire : c'est la contrepartie de tuiles gratuites.
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution:
            '&copy; les contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(map);

      const icon = leaflet.divIcon({
        className: 'sp-map-marker',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: '<span aria-hidden="true"></span>',
      });

      const marker = leaflet
        .marker([center.latitude, center.longitude], {
          draggable: true,
          icon,
          keyboard: false,
          opacity: value ? 1 : 0.45,
        })
        .addTo(map);

      marker.on('dragend', () => {
        const position = marker.getLatLng();
        marker.setOpacity(1);
        onChangeRef.current({
          latitude: roundCoordinate(position.lat),
          longitude: roundCoordinate(position.lng),
        });
      });

      map.on('click', (event) => {
        marker.setLatLng(event.latlng);
        marker.setOpacity(1);
        onChangeRef.current({
          latitude: roundCoordinate(event.latlng.lat),
          longitude: roundCoordinate(event.latlng.lng),
        });
      });

      mapRef.current = map;
      markerRef.current = marker;
      setMapReady(true);
    };

    void start();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      map?.remove();
    };
    // Volontairement monté une seule fois : les changements de valeur sont
    // répercutés par l'effet suivant, sans détruire la carte à chaque frappe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Synchronise la carte avec la valeur, d'où qu'elle vienne (champs, résultat
  // de recherche). Sans cela, choisir une adresse laisserait le marqueur en
  // place et l'écran mentirait sur le lieu enregistré.
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker || !value) return;

    marker.setLatLng([value.latitude, value.longitude]);
    marker.setOpacity(1);
    map.setView([value.latitude, value.longitude], Math.max(map.getZoom(), 15));
  }, [value]);

  // --- Recherche d'adresse -------------------------------------------------

  const search = useCallback(async (term: string) => {
    setSearching(true);
    setSearchError(null);
    try {
      const response = await fetch(`/api/admin/geocode?q=${encodeURIComponent(term)}`);
      const body = (await response.json().catch(() => null)) as
        | { results?: GeocodeResult[]; error?: { message?: string } }
        | null;

      if (!response.ok) {
        setResults([]);
        setSearchError(body?.error?.message ?? 'La recherche a échoué.');
        return;
      }
      setResults(body?.results ?? []);
      if ((body?.results ?? []).length === 0) {
        setSearchError('Aucune adresse trouvée. Précisez la recherche, ou placez le marqueur.');
      }
    } catch {
      setResults([]);
      setSearchError('La recherche a échoué. Vérifiez votre connexion.');
    } finally {
      setSearching(false);
    }
  }, []);

  // Temporisation : la politique d'usage d'OpenStreetMap plafonne le rythme
  // des appels. Une requête par frappe la violerait, et le serveur les
  // refuserait de toute façon.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 3) {
      setResults([]);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(() => void search(term), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  const pick = (result: GeocodeResult) => {
    onChange({
      latitude: roundCoordinate(result.latitude),
      longitude: roundCoordinate(result.longitude),
    });
    onAddressPicked?.(result.label);
    setResults([]);
    setQuery('');
  };

  const setCoordinate = (key: keyof LatLng, raw: string) => {
    if (raw.trim() === '') {
      onChange(null);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const next = {
      latitude: value?.latitude ?? 0,
      longitude: value?.longitude ?? 0,
      [key]: parsed,
    } as LatLng;
    if (!isValidLatitude(next.latitude) || !isValidLongitude(next.longitude)) return;
    onChange(next);
  };

  return (
    <div className="sp-stack" style={{ '--sp-stack-gap': '1rem' } as React.CSSProperties}>
      <Field
        id={`${baseId}-recherche`}
        label="Rechercher une adresse"
        hint="Trois caractères au minimum. Les résultats viennent d’OpenStreetMap."
        error={searchError}
      >
        {(attributes) => (
          <input
            {...attributes}
            className="sp-input"
            type="search"
            value={query}
            maxLength={200}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
      </Field>

      {/* Le résultat de la recherche est annoncé : sans cela, une liste qui
          apparaît après un délai passe inaperçue au lecteur d'écran. */}
      <div aria-live="polite" className="sp-visually-hidden">
        {searching
          ? 'Recherche en cours.'
          : results.length > 0
            ? `${results.length} adresse${results.length > 1 ? 's' : ''} proposée${results.length > 1 ? 's' : ''}.`
            : ''}
      </div>

      {results.length > 0 ? (
        <ul className="sp-geocode-results">
          {results.map((result) => (
            <li key={`${result.latitude},${result.longitude},${result.label}`}>
              <button
                className="sp-geocode-result"
                type="button"
                onClick={() => pick(result)}
              >
                <span>{result.label}</span>
                {result.kind ? <span className="sp-badge">{result.kind}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="sp-row">
        <Field id={`${baseId}-lat`} label="Latitude">
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              type="number"
              step="any"
              min={-90}
              max={90}
              value={value?.latitude ?? ''}
              onChange={(event) => setCoordinate('latitude', event.target.value)}
            />
          )}
        </Field>
        <Field id={`${baseId}-lng`} label="Longitude">
          {(attributes) => (
            <input
              {...attributes}
              className="sp-input"
              type="number"
              step="any"
              min={-180}
              max={180}
              value={value?.longitude ?? ''}
              onChange={(event) => setCoordinate('longitude', event.target.value)}
            />
          )}
        </Field>
      </div>

      <div>
        <p className="sp-hint" id={`${baseId}-carte-aide`}>
          Cliquez sur la carte ou faites glisser le marqueur pour ajuster le point. Les
          coordonnées ci-dessus restent modifiables au clavier.
        </p>
        {/* `role="application"` serait un mensonge : rien n'est utilisable au
            clavier ici. La carte est décrite, et l'équivalent clavier est
            au-dessus. */}
        <div
          aria-describedby={`${baseId}-carte-aide`}
          className="sp-map"
          ref={containerRef}
          role="img"
          aria-label={
            value
              ? `Carte centrée sur la latitude ${value.latitude}, longitude ${value.longitude}`
              : 'Carte de localisation, aucun point choisi'
          }
        />
        {!mapReady ? <p className="sp-muted">Chargement de la carte…</p> : null}
      </div>
    </div>
  );
}
