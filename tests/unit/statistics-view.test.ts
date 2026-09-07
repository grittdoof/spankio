import { describe, expect, it } from 'vitest';
import {
  GUEST_MAX,
  GUEST_PAGE,
  parseStatisticsTab,
  parseStatisticsView,
  statisticsUrl,
} from '@/lib/admin/statistics-view';

/**
 * État de l'écran des statistiques.
 *
 * Il vit dans l'URL : ces tests fixent donc les deux propriétés qui rendent
 * cela sûr — seules des valeurs de LISTES FERMÉES sont interprétées, et une
 * valeur bricolée retombe sur le défaut au lieu d'échouer. La recherche est la
 * seule valeur libre, et elle n'est jamais interprétée : elle ne filtre que des
 * lignes déjà lues.
 */

describe('lecture de l’URL', () => {
  it('retombe sur la vue d’ensemble par défaut', () => {
    expect(parseStatisticsTab(undefined)).toBe('apercu');
    expect(parseStatisticsTab('inventé')).toBe('apercu');
    expect(parseStatisticsTab('invites')).toBe('invites');
  });

  it('lit les trois dimensions de la vue', () => {
    expect(
      parseStatisticsView({
        onglet: 'invites',
        periode: '30j',
        filtre: 'presents',
        q: 'Élodie',
        lignes: '60',
      }),
    ).toEqual({
      tab: 'invites',
      period: '30j',
      filter: 'attending',
      search: 'Élodie',
      shown: 60,
    });
  });

  it('ne se laisse pas dicter un nombre de lignes arbitraire', () => {
    expect(parseStatisticsView({ lignes: '999999' }).shown).toBe(GUEST_MAX);
    expect(parseStatisticsView({ lignes: '1' }).shown).toBe(GUEST_PAGE);
    expect(parseStatisticsView({ lignes: 'beaucoup' }).shown).toBe(GUEST_PAGE);
    expect(parseStatisticsView({ lignes: '-5' }).shown).toBe(GUEST_PAGE);
  });

  it('borne la recherche : une valeur de plusieurs kilo-octets est un collage', () => {
    expect(parseStatisticsView({ q: 'a'.repeat(500) }).search).toHaveLength(80);
  });

  it('prend la première valeur d’un paramètre répété', () => {
    expect(parseStatisticsView({ onglet: ['questions', 'invites'] }).tab).toBe('questions');
  });
});

describe('écriture de l’URL', () => {
  it('omet les valeurs par défaut : une URL neutre reste courte', () => {
    expect(statisticsUrl('abc', { tab: 'apercu', period: '7j', filter: 'all' })).toBe(
      '/admin/sondages/abc/reponses',
    );
  });

  it('écrit ce qui s’écarte du défaut', () => {
    expect(
      statisticsUrl('abc', { tab: 'invites', filter: 'declined', search: 'Zebiri' }),
    ).toBe('/admin/sondages/abc/reponses?onglet=invites&filtre=declinent&q=Zebiri');
  });

  it('échappe la recherche : un terme n’est jamais recopié tel quel dans l’URL', () => {
    expect(statisticsUrl('abc', { tab: 'invites', search: 'a&b=c d' })).toContain(
      'q=a%26b%3Dc+d',
    );
  });

  it('fait l’aller-retour sans perdre l’état', () => {
    const url = statisticsUrl('abc', {
      tab: 'invites',
      period: '30j',
      filter: 'unknown',
      search: 'paris',
      shown: 90,
    });
    const query = Object.fromEntries(new URL(url, 'https://x.test').searchParams);
    expect(parseStatisticsView(query)).toEqual({
      tab: 'invites',
      period: '30j',
      filter: 'unknown',
      search: 'paris',
      shown: 90,
    });
  });
});
