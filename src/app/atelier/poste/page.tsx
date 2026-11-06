import { notFound } from 'next/navigation';
import { Desk } from '@/components/checkin/Desk';
import { parseDeskMode } from '@/lib/checkin/mode';
import type { WalkinField } from '@/lib/checkin/walkin';
import type { GuestRow } from '@/lib/survey/guests';

/**
 * Le poste d'accueil, sans session — HORS PRODUCTION.
 *
 * Même raison d'être que `/atelier` : le vrai poste exige un compte affecté à
 * un événement, ce qui empêchait de vérifier une décision de mise en page —
 * ici la barre fixée en bas, qu'on ne juge qu'à 375 px, clavier ouvert. Il
 * tourne en ESSAI À BLANC : rien ne part, aucune donnée réelle n'est lue.
 */

const GUESTS: GuestRow[] = [
  ['Élodie Marchand', 'Agence de Lyon', 2, 'Jacqueline Marchand'],
  ['Karim Benali', 'Atelier Benali', 1, null],
  ['Sophie Nguyen', 'Conseil Nguyen', 1, null],
  ['Paul Arnaud', 'Arnaud & fils', 2, null],
  ['Lucie Fabre', null, 1, null],
  ['Marc Lemoine', 'Lemoine SA', 1, null],
  ['Inès Haddad', 'Haddad Conseil', 1, null],
  ['Thomas Girard', 'Girard BTP', 2, 'Claire Girard'],
].map(([name, detail, people, companion], index) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  submittedAt: `2026-11-0${(index % 9) + 1}T10:00:00.000Z`,
  name: name as string,
  initials: (name as string)
    .split(' ')
    .map((word) => word[0])
    .join(''),
  detail: detail as string | null,
  companion: companion as string | null,
  status: 'attending',
  people: people as number,
  ambiguous: false,
  walkIn: false,
}));

const FIELDS: WalkinField[] = [
  { id: 'nom', label: 'Quel est votre nom ?', type: 'text', role: 'identity' },
  { id: 'prenom', label: 'Quel est votre prénom ?', type: 'text', role: 'identity' },
  { id: 'societe', label: 'Société', type: 'text', role: 'detail' },
];

export default async function AtelierDeskPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const query = await searchParams;

  return (
    <div className="sp-deskshell">
      <header className="sp-deskshell__bar">
        <span className="sp-deskshell__brand">Atelier — poste d’accueil</span>
      </header>
      <main className="sp-deskshell__main">
        <Desk
          counting
          guests={GUESTS}
          initialMode={parseDeskMode(query['mode'])}
          initialStates={[]}
          organisationName="Organisation de démonstration"
          printHref="/atelier/poste"
          rehearsal
          surveyId="atelier"
          title="Soirée de démonstration"
          walkinFields={FIELDS}
        />
      </main>
    </div>
  );
}
