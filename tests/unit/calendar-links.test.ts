import { describe, expect, it } from 'vitest';
import {
  calendarLinks,
  directionsLinks,
  googleCalendarUrl,
  outlookCalendarUrl,
} from '@/lib/event/calendar-links';

const target = {
  title: 'Réunion d’information',
  start: new Date('2027-06-15T18:30:00.000Z'),
  end: new Date('2027-06-15T20:00:00.000Z'),
  location: 'Salle des fêtes, 12 rue de l’Église',
  description: 'Ordre du jour : point 1, point 2',
};

function params(url: string): URLSearchParams {
  return new URL(url).searchParams;
}

describe('lien Google Agenda', () => {
  it('encode le créneau au format compact UTC', () => {
    const p = params(googleCalendarUrl(target));
    expect(p.get('action')).toBe('TEMPLATE');
    expect(p.get('text')).toBe('Réunion d’information');
    expect(p.get('dates')).toBe('20270615T183000Z/20270615T200000Z');
  });

  it('rend la fin exclusive pour une journée entière', () => {
    const p = params(googleCalendarUrl({ ...target, allDay: true }));
    expect(p.get('dates')).toBe('20270615/20270616');
  });

  it('utilise le début comme fin quand aucune fin n’est fournie', () => {
    const p = params(googleCalendarUrl({ ...target, end: null }));
    expect(p.get('dates')).toBe('20270615T183000Z/20270615T183000Z');
  });

  it('transmet lieu et description, et omet ce qui est vide', () => {
    const rempli = params(googleCalendarUrl(target));
    expect(rempli.get('location')).toBe('Salle des fêtes, 12 rue de l’Église');
    expect(rempli.get('details')).toBe('Ordre du jour : point 1, point 2');

    const vide = params(googleCalendarUrl({ ...target, location: '  ', description: null }));
    expect(vide.has('location')).toBe(false);
    expect(vide.has('details')).toBe(false);
  });

  it('encode les caractères spéciaux plutôt que de casser l’URL', () => {
    const url = googleCalendarUrl({ ...target, title: 'Atelier « bois & métal »' });
    expect(() => new URL(url)).not.toThrow();
    expect(params(url).get('text')).toBe('Atelier « bois & métal »');
  });
});

describe('lien Outlook', () => {
  it('utilise des dates ISO', () => {
    const p = params(outlookCalendarUrl(target));
    expect(p.get('rru')).toBe('addevent');
    expect(p.get('subject')).toBe('Réunion d’information');
    expect(p.get('startdt')).toBe('2027-06-15T18:30:00.000Z');
    expect(p.get('enddt')).toBe('2027-06-15T20:00:00.000Z');
  });

  it('signale une journée entière par un indicateur, pas par un autre format', () => {
    const p = params(outlookCalendarUrl({ ...target, allDay: true }));
    expect(p.get('allday')).toBe('true');
    expect(p.get('startdt')).toBe('2027-06-15');
    expect(p.get('enddt')).toBe('2027-06-16');
  });
});

describe('trois façons d’ajouter à un agenda', () => {
  it('réunit les deux liens et le chemin du fichier', () => {
    const links = calendarLinks(target, '/api/ics/abc');
    expect(links.google).toContain('calendar.google.com');
    expect(links.outlook).toContain('outlook.office.com');
    expect(links.ics).toBe('/api/ics/abc');
  });
});

describe('liens d’itinéraire', () => {
  it('privilégie les coordonnées, sans ambiguïté', () => {
    const links = directionsLinks({
      latitude: 48.8566,
      longitude: 2.3522,
      address: '12 rue de l’Église',
    });
    expect(params(links!.google).get('destination')).toBe('48.8566,2.3522');
    expect(params(links!.openStreetMap).get('route')).toBe(';48.8566,2.3522');
    expect(params(links!.apple).get('daddr')).toBe('48.8566,2.3522');
  });

  it('retombe sur l’adresse, puis sur le nom du lieu', () => {
    const adresse = directionsLinks({ address: '12 rue de l’Église' });
    expect(params(adresse!.google).get('destination')).toBe('12 rue de l’Église');

    const libelle = directionsLinks({ label: 'Salle des fêtes' });
    expect(params(libelle!.google).get('destination')).toBe('Salle des fêtes');
  });

  it('renvoie null quand aucune destination n’est exploitable', () => {
    // Un bouton « itinéraire » qui ouvre une carte vide est pire qu'un bouton
    // absent : mieux vaut ne rien afficher.
    expect(directionsLinks({})).toBeNull();
    expect(directionsLinks({ address: '   ', label: null })).toBeNull();
  });

  it('exige les deux coordonnées, pas une seule', () => {
    expect(directionsLinks({ latitude: 48.8566 })).toBeNull();
    expect(directionsLinks({ longitude: 2.3522, label: 'Repli' })).not.toBeNull();
    expect(params(directionsLinks({ longitude: 2.3522, label: 'Repli' })!.google).get('destination')).toBe(
      'Repli',
    );
  });
});
