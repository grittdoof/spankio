import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ANON, OWNER, asUser, createTestDb, type TestDb } from '../helpers/db';
import { createAccount, seedTwoTenants, type Tenant } from '../helpers/seed';

/**
 * L'invitation à usage unique.
 *
 * Elle remplace la demande de rattachement validée par le super-administrateur
 * pour un rôle — `host` — qui ne donne rien par lui-même. C'est donc une
 * autorité NOUVELLE accordée à l'administrateur d'une organisation, et c'est
 * exactement ce qui justifie que ce fichier existe.
 *
 * Le contrôle central est celui de l'ADRESSE. Le jeton seul ne doit pas
 * suffire : un lien se transfère, s'oublie dans une boîte partagée, se
 * retrouve dans l'historique d'un navigateur prêté. Et la comparaison se fait
 * contre le courriel du JETON, jamais contre `profiles.email` — la policy
 * `profiles_update` laisse chacun modifier sa propre ligne, donc son adresse.
 */
describe('invitation à usage unique', () => {
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

  let compteur = 0;

  /** Pose une invitation directement en base, et rend son jeton en clair. */
  async function invite(options: {
    surveyId?: string;
    organisationId?: string;
    email: string;
    expiresIn?: string;
    claimed?: boolean;
  }): Promise<string> {
    compteur += 1;
    const token = `jeton-de-test-${compteur}`;
    await db.query(
      OWNER,
      `insert into public.checkin_invitations
         (survey_id, organisation_id, email, token_hash, expires_at, claimed_at)
       values ($1, $2, $3,
               encode(sha256(convert_to($4::text, 'UTF8')), 'hex'),
               now() + $5::interval,
               case when $6::boolean then now() else null end)`,
      [
        options.surveyId ?? a.eventSurvey,
        options.organisationId ?? a.organisationId,
        options.email,
        token,
        options.expiresIn ?? '7 days',
        options.claimed ?? false,
      ],
    );
    return token;
  }

  async function claim(userId: string, email: string, token: string) {
    return db.query<{ claim_checkin_invitation: { survey_id: string } }>(
      asUser(userId, email),
      'select public.claim_checkin_invitation($1) as claim_checkin_invitation',
      [token],
    );
  }

  async function profileOf(id: string) {
    const rows = await db.query<{
      organisation_id: string | null;
      role: string;
      status: string;
    }>(OWNER, 'select organisation_id, role, status from public.profiles where id = $1', [id]);
    return rows[0];
  }

  describe('ce qu’une invitation valide ouvre', () => {
    it('rattache un compte non rattaché, en rôle d’accueil, et l’affecte', async () => {
      const invitee = await createAccount(db, 'camille@traiteur.test', 'Camille Roux');
      expect((await profileOf(invitee))!.organisation_id).toBeNull();

      const token = await invite({ email: 'camille@traiteur.test' });
      const result = await claim(invitee, 'camille@traiteur.test', token);
      expect(result[0]!.claim_checkin_invitation.survey_id).toBe(a.eventSurvey);

      const profile = await profileOf(invitee);
      expect(profile!.organisation_id).toBe(a.organisationId);
      // `host` et rien d'autre : le rôle ne donne aucun accès par lui-même.
      expect(profile!.role).toBe('host');
      expect(profile!.status).toBe('active');

      const staff = await db.query<{ n: string }>(
        OWNER,
        `select count(*) as n from public.checkin_staff
          where survey_id = $1 and profile_id = $2`,
        [a.eventSurvey, invitee],
      );
      expect(Number(staff[0]!.n)).toBe(1);
    });

    it('ne vaut qu’UNE fois', async () => {
      const invitee = await createAccount(db, 'sacha@traiteur.test', 'Sacha');
      const token = await invite({ email: 'sacha@traiteur.test' });
      await claim(invitee, 'sacha@traiteur.test', token);

      await expect(claim(invitee, 'sacha@traiteur.test', token)).rejects.toThrow(/PT404|invalide/i);
    });

    it('ouvre bien la liste des invités, une fois consommée', async () => {
      const invitee = await createAccount(db, 'ines@traiteur.test', 'Inès');
      const token = await invite({ email: 'ines@traiteur.test' });
      await claim(invitee, 'ines@traiteur.test', token);

      const rows = await db.query<{ id: string }>(
        asUser(invitee, 'ines@traiteur.test'),
        'select id from public.survey_responses where survey_id = $1',
        [a.eventSurvey],
      );
      // Le but entier du lot : une personne qui n'existait pas il y a une
      // minute tient la porte, et ne voit QUE cet événement.
      expect(rows.length).toBeGreaterThan(0);

      const autres = await db.query<{ id: string }>(
        asUser(invitee, 'ines@traiteur.test'),
        'select id from public.survey_responses where survey_id = $1',
        [a.survey],
      );
      expect(autres).toEqual([]);
    });
  });

  describe('ce que le jeton seul ne suffit PAS à ouvrir', () => {
    it('refuse une adresse différente de celle invitée', async () => {
      const intrus = await createAccount(db, 'intrus@ailleurs.test', 'Intrus');
      const token = await invite({ email: 'camille2@traiteur.test' });

      // Le cas réel : un lien transféré, oublié dans une boîte partagée, ou
      // retrouvé dans l'historique d'un navigateur prêté.
      await expect(claim(intrus, 'intrus@ailleurs.test', token)).rejects.toThrow(/PT403|autre adresse/i);
      expect((await profileOf(intrus))!.organisation_id).toBeNull();
    });

    it('refuse un jeton sans adresse au jeton d’authentification', async () => {
      const invitee = await createAccount(db, 'sansmail@traiteur.test', 'Sans adresse');
      const token = await invite({ email: 'sansmail@traiteur.test' });

      // Fail-closed assumé : un jeton Supabase sans courriel — un compte créé
      // par téléphone, par exemple — ne peut pas réclamer.
      await expect(
        db.query(
          asUser(invitee),
          'select public.claim_checkin_invitation($1)',
          [token],
        ),
      ).rejects.toThrow(/PT403|autre adresse/i);
    });

    it('ne se laisse pas contourner en changeant son propre courriel de profil', async () => {
      const intrus = await createAccount(db, 'malin@ailleurs.test', 'Malin');
      const token = await invite({ email: 'cible@traiteur.test' });

      // `profiles_update` autorise `id = auth.uid()` : l'intrus PEUT réécrire
      // son adresse de profil. C'est précisément pourquoi la comparaison se
      // fait contre le jeton.
      await db.query(
        asUser(intrus, 'malin@ailleurs.test'),
        'update public.profiles set email = $1 where id = $2',
        ['cible@traiteur.test', intrus],
      );

      await expect(claim(intrus, 'malin@ailleurs.test', token)).rejects.toThrow(/PT403|autre adresse/i);
      expect((await profileOf(intrus))!.organisation_id).toBeNull();
    });

    it('refuse un lien périmé', async () => {
      const invitee = await createAccount(db, 'tard@traiteur.test', 'Tard');
      const token = await invite({ email: 'tard@traiteur.test', expiresIn: '-1 hour' });
      await expect(claim(invitee, 'tard@traiteur.test', token)).rejects.toThrow(/PT404|invalide/i);
    });

    it('refuse un jeton inconnu', async () => {
      const invitee = await createAccount(db, 'inconnu@traiteur.test', 'Inconnu');
      await expect(
        claim(invitee, 'inconnu@traiteur.test', 'jeton-inexistant'),
      ).rejects.toThrow(/PT404|invalide/i);
    });

    it('n’est même pas exécutable par un visiteur sans session', async () => {
      const token = await invite({ email: 'anon@traiteur.test' });
      // Refus plus FRANC que celui que la fonction sait rendre : le `grant` a
      // été retiré à `anon`, donc PostgreSQL arrête l'appel avant son premier
      // `begin`. Le garde interne reste utile — il couvre un `authenticated`
      // sans `sub` — mais ce n'est pas lui qui parle ici.
      await expect(
        db.query(ANON, 'select public.claim_checkin_invitation($1)', [token]),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuse un compte déjà rattaché à une AUTRE organisation', async () => {
      const token = await invite({ email: 'b-admin@traiteur.test' });
      await db.query(OWNER, 'update public.profiles set email = $1 where id = $2', [
        'b-admin@traiteur.test',
        b.viewer,
      ]);

      // Déplacer quelqu'un d'une organisation à une autre est exactement ce
      // que le trigger anti-escalade interdit.
      await expect(claim(b.viewer, 'b-admin@traiteur.test', token)).rejects.toThrow(
        /PT409|autre organisation/i,
      );
    });
  });

  describe('ce que l’invitation ne DÉGRADE pas', () => {
    it('ne rétrograde pas un administrateur de la même organisation', async () => {
      const avant = await profileOf(a.admin);
      await db.query(OWNER, 'update public.profiles set email = $1 where id = $2', [
        'admin-a@traiteur.test',
        a.admin,
      ]);
      const token = await invite({ email: 'admin-a@traiteur.test' });

      await claim(a.admin, 'admin-a@traiteur.test', token);

      // Un administrateur qui essaie son propre lien ne doit pas se retrouver
      // en rôle d'accueil, c'est-à-dire privé de son organisation.
      const apres = await profileOf(a.admin);
      expect(apres!.role).toBe(avant!.role);
      expect(apres!.organisation_id).toBe(avant!.organisation_id);
    });
  });

  describe('qui peut inviter', () => {
    it("l'éditeur ne peut pas : inviter est un acte sur un COMPTE", async () => {
      await db
        .query(
          asUser(a.editor, 'editeur@a.test'),
          `insert into public.checkin_invitations
             (survey_id, organisation_id, email, token_hash, expires_at)
           values ($1, $2, 'x@y.test', 'empreinte', now() + interval '1 day')`,
          [a.eventSurvey, a.organisationId],
        )
        .catch(() => undefined);

      const rows = await db.query<{ n: string }>(
        OWNER,
        "select count(*) as n from public.checkin_invitations where email = 'x@y.test'",
      );
      expect(Number(rows[0]!.n)).toBe(0);
    });

    it('un compte d’accueil ne lit aucune invitation', async () => {
      const rows = await db.query<{ id: string }>(
        asUser(a.host, 'host-a@a.test'),
        'select id from public.checkin_invitations',
      );
      // Il n'a aucune raison de connaître les adresses invitées de la soirée.
      expect(rows).toEqual([]);
    });

    it("l'administrateur d'une autre organisation n'en lit aucune non plus", async () => {
      const rows = await db.query<{ id: string }>(
        asUser(b.admin, 'admin-b@b.test'),
        'select id from public.checkin_invitations where organisation_id = $1',
        [a.organisationId],
      );
      expect(rows).toEqual([]);
    });
  });
});
