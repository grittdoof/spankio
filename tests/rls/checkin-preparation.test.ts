import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OWNER, asUser, createTestDb, type TestDb } from '../helpers/db';
import { seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * Préparation de la porte : affectations et traçage des connexions.
 *
 * Le contrôle central de ce fichier est né d'un défaut que j'étais en train
 * d'écrire. La première version de la migration ouvrait une policy d'UPDATE
 * sur `checkin_staff` bornée à `profile_id = auth.uid()`, en comptant sur un
 * `grant` de colonne pour limiter l'écriture à deux horodatages. C'était faux :
 * le lot 1 avait déjà accordé `update` sur la TABLE, un `grant` de colonne
 * s'ajoute au lieu de retirer, et le RLS ne voit pas les colonnes. Une hôtesse
 * aurait pu prolonger seule son `expires_at`, c'est-à-dire son accès à une
 * liste nominative de plusieurs centaines de personnes.
 */
/** Instant comparable, quelle que soit la forme rendue par l'adaptateur. */
function instant(value: string | Date | null): number | null {
  return value === null ? null : new Date(value).getTime();
}

describe('préparation du poste d’accueil', () => {
  let db: TestDb;
  let a: Tenant;
  let b: Tenant;

  beforeAll(async () => {
    db = await createTestDb();
    const seeded = await seedTwoTenants(db);
    a = seeded.a;
    b = seeded.b;
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  async function staffRow(surveyId: string, profileId: string) {
    // L'adaptateur rend des `Date`, pas des chaînes : on compare donc des
    // instants, jamais des objets ni leur sérialisation.
    const rows = await db.query<{
      expires_at: string | Date | null;
      first_seen_at: string | Date | null;
      last_seen_at: string | Date | null;
    }>(
      OWNER,
      `select expires_at, first_seen_at, last_seen_at
         from public.checkin_staff
        where survey_id = $1 and profile_id = $2`,
      [surveyId, profileId],
    );
    return rows[0];
  }

  describe('une hôtesse marque qu’elle a ouvert son poste', () => {
    it('écrit les deux horodatages, et renvoie vrai', async () => {
      const result = await db.query<{ touch_checkin_staff: boolean }>(
        asUser(a.host),
        'select public.touch_checkin_staff($1) as touch_checkin_staff',
        [a.eventSurvey],
      );
      expect(result[0]!.touch_checkin_staff).toBe(true);

      const row = await staffRow(a.eventSurvey, a.host);
      expect(row!.first_seen_at).not.toBeNull();
      expect(row!.last_seen_at).not.toBeNull();
    });

    it('garde la PREMIÈRE ouverture et avance la dernière', async () => {
      const before = await staffRow(a.eventSurvey, a.host);
      await db.query(OWNER, 'select pg_sleep(0.01)');
      await db.query(
        asUser(a.host),
        'select public.touch_checkin_staff($1)',
        [a.eventSurvey],
      );
      const after = await staffRow(a.eventSurvey, a.host);

      // « Sait-elle se connecter ? » se répond une fois pour toutes : écraser
      // la première ouverture effacerait précisément la preuve qu'on cherche.
      expect(instant(after!.first_seen_at)).toBe(instant(before!.first_seen_at));
      expect(instant(after!.last_seen_at) ?? 0).toBeGreaterThanOrEqual(
        instant(before!.last_seen_at) ?? 0,
      );
    });

    it('renvoie faux, sans erreur, pour qui n’est pas affecté', async () => {
      // Ouvrir une page dont on vient d'être retiré n'a rien d'anormal : ce
      // n'est pas une faute, c'est un non-événement.
      const result = await db.query<{ touch_checkin_staff: boolean }>(
        asUser(a.idleHost),
        'select public.touch_checkin_staff($1) as touch_checkin_staff',
        [a.eventSurvey],
      );
      expect(result[0]!.touch_checkin_staff).toBe(false);
    });

    it('ne touche rien chez une autre organisation', async () => {
      const result = await db.query<{ touch_checkin_staff: boolean }>(
        asUser(b.host),
        'select public.touch_checkin_staff($1) as touch_checkin_staff',
        [a.eventSurvey],
      );
      expect(result[0]!.touch_checkin_staff).toBe(false);
    });
  });

  describe('ce qu’une hôtesse ne peut PAS écrire sur sa propre affectation', () => {
    it('ne prolonge pas son accès', async () => {
      const before = await staffRow(a.eventSurvey, a.host);
      const futur = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

      await db
        .query(
          asUser(a.host),
          `update public.checkin_staff set expires_at = $1
            where survey_id = $2 and profile_id = $3`,
          [futur, a.eventSurvey, a.host],
        )
        .catch(() => undefined);

      const after = await staffRow(a.eventSurvey, a.host);
      // Aucune policy d'UPDATE ne la vise : l'écriture ne touche aucune ligne.
      // On vérifie la DONNÉE et non un code d'erreur, parce qu'une clause
      // `using` filtre en silence au lieu de lever.
      expect(instant(after!.expires_at)).toBe(instant(before!.expires_at));
    });

    it('ne s’affecte pas elle-même à un autre événement', async () => {
      await db
        .query(
          asUser(a.host),
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [a.survey, a.host, a.organisationId],
        )
        .catch(() => undefined);

      const rows = await db.query<{ n: string }>(
        OWNER,
        'select count(*) as n from public.checkin_staff where survey_id = $1',
        [a.survey],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });

  describe('qui affecte', () => {
    it("l'administrateur de l'organisation affecte un de ses membres", async () => {
      await db.query(
        asUser(a.admin),
        `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
         values ($1, $2, $3)`,
        [a.eventSurvey, a.idleHost, a.organisationId],
      );

      const row = await staffRow(a.eventSurvey, a.idleHost);
      expect(row).toBeDefined();
      // Une affectation toute neuve n'a jamais été ouverte : c'est exactement
      // ce que l'écran de préparation doit montrer la veille.
      expect(row!.first_seen_at).toBeNull();
    });

    it("l'administrateur d'une AUTRE organisation ne peut pas", async () => {
      await db
        .query(
          asUser(b.admin),
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [a.eventSurvey, b.host, b.organisationId],
        )
        .catch(() => undefined);

      const rows = await db.query<{ n: string }>(
        OWNER,
        `select count(*) as n from public.checkin_staff
          where survey_id = $1 and profile_id = $2`,
        [a.eventSurvey, b.host],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it("l'éditeur ne peut pas : affecter est un acte sur un COMPTE", async () => {
      await db
        .query(
          asUser(a.editor),
          `insert into public.checkin_staff (survey_id, profile_id, organisation_id)
           values ($1, $2, $3)`,
          [a.eventSurvey, a.viewer, a.organisationId],
        )
        .catch(() => undefined);

      const rows = await db.query<{ n: string }>(
        OWNER,
        `select count(*) as n from public.checkin_staff
          where survey_id = $1 and profile_id = $2`,
        [a.eventSurvey, a.viewer],
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });
  });
});
