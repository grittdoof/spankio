'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { fr, responseErrorMessage, submitErrorMessage } from '@/lib/i18n/fr';
import type { ConsentNotice } from '@/lib/survey/consent';
import { visibleFields, visibleSteps } from '@/lib/survey/conditions';
import { otherKey, type SurveyField, type SurveySchema, type SurveyStep } from '@/lib/survey/schema';
import { hasDeclined, type AttendanceSettings } from '@/lib/survey/attendance';
import { validateResponse } from '@/lib/survey/validate-response';
import { FieldInput } from './FieldInput';
import {
  ConsentScreen,
  StepIntroScreen,
  ThankYouScreen,
  WelcomeScreen,
  type Branding,
  type CalendarActions,
  type DirectionsActions,
  type WelcomeContent,
} from './screens';

/**
 * Moteur du formulaire public : une question par écran.
 *
 * Deux principes structurent ce composant :
 *
 *  1. **La validation côté client est LA MÊME que côté serveur.** Il n'y a pas
 *     de règle « d'interface » : `validateResponse` est appelée ici avec le
 *     schéma, et on n'affiche que les erreurs du champ courant. Impossible que
 *     l'écran accepte ce que le serveur refusera, ou l'inverse.
 *
 *  2. **Les écrans sont recalculés à chaque réponse.** Un champ conditionnel
 *     apparaît ou disparaît immédiatement, et le compteur « n / N » suit — il
 *     annonce le parcours réel, pas le nombre total de questions du schéma.
 */

type Screen =
  | { readonly kind: 'intro'; readonly step: SurveyStep; readonly stepIndex: number }
  | { readonly kind: 'field'; readonly step: SurveyStep; readonly field: SurveyField };

export interface SurveyRendererProps {
  schema: SurveySchema;
  branding: Branding;
  /**
   * Contenu de l'invitation, déjà FILTRÉ par les interrupteurs de la page
   * publique : le moteur ne décide pas de ce qui s'affiche, il l'affiche.
   */
  welcome: Omit<WelcomeContent, 'branding'>;
  consent: { required: boolean; notice: ConsentNotice; checkboxLabel: string; privacyHref: string };
  thankYou: {
    title: string;
    message?: string | undefined;
    /**
     * Variante d'un REFUS. Les textes viennent de la plateforme, pas de
     * l'organisation : son message est écrit pour les personnes qui viennent.
     */
    declined: { title: string; message?: string | undefined };
  };
  /**
   * Désignation du comptage, pour savoir si la réponse décline. Sans elle, la
   * plateforme ne peut pas le savoir — et n'invente rien.
   */
  attendance?: AttendanceSettings | undefined;
  event?:
    | {
        calendar: CalendarActions;
        directions?: DirectionsActions | undefined;
        summary?: readonly string[];
      }
    | undefined;
  /** Envoie la réponse. Renvoie les erreurs par champ en cas de refus. */
  onSubmit: (payload: {
    data: Record<string, unknown>;
    consentGiven: boolean;
  }) => Promise<{ ok: true } | { ok: false; code?: string; fields?: Record<string, string> }>;
}

type Phase = 'welcome' | 'form' | 'consent' | 'done';

export function SurveyRenderer({
  schema,
  branding,
  welcome,
  consent,
  thankYou,
  attendance,
  event,
  onSubmit,
}: SurveyRendererProps) {
  const [phase, setPhase] = useState<Phase>('welcome');
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [shake, setShake] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [sending, setSending] = useState(false);

  const headingRef = useRef<HTMLDivElement>(null);

  /** Écrans applicables, recalculés à chaque réponse. */
  const screens = useMemo<Screen[]>(() => {
    const steps = visibleSteps(schema, answers);
    const fields = visibleFields(schema, answers);
    const result: Screen[] = [];

    steps.forEach((step, stepIndex) => {
      const stepFields = fields.filter((entry) => entry.step.id === step.id);
      if (stepFields.length === 0) return;
      if (step.intro && !step.hideIntro) {
        result.push({ kind: 'intro', step, stepIndex });
      }
      for (const entry of stepFields) {
        result.push({ kind: 'field', step, field: entry.field });
      }
    });

    return result;
  }, [schema, answers]);

  const current = screens[Math.min(index, screens.length - 1)];
  const questionScreens = screens.filter((screen) => screen.kind === 'field');
  const questionNumber =
    current?.kind === 'field'
      ? questionScreens.findIndex((screen) => screen === current) + 1
      : questionScreens.filter((screen) => screens.indexOf(screen) < index).length;
  const progress =
    questionScreens.length === 0 ? 0 : Math.round((questionNumber / questionScreens.length) * 100);

  // Le titre de l'écran reçoit le focus à chaque changement : sans cela, un
  // lecteur d'écran resterait sur le bouton « suivant » et n'annoncerait
  // jamais la question qui vient d'apparaître.
  useEffect(() => {
    if (phase === 'form' || phase === 'consent' || phase === 'done') {
      headingRef.current?.focus();
    }
  }, [index, phase]);

  const setAnswer = useCallback((fieldId: string, value: unknown) => {
    setAnswers((previous) => ({ ...previous, [fieldId]: value }));
    setFieldError(null);
  }, []);

  /** Erreurs du champ courant, calculées par la validation partagée. */
  const currentFieldErrors = useCallback(
    (fieldId: string): string | null => {
      const result = validateResponse(schema, answers);
      if (result.ok) return null;
      const error = result.errors.find((entry) => entry.field === fieldId);
      return error ? responseErrorMessage(error.code, error.params) : null;
    },
    [schema, answers],
  );

  /**
   * Minuteur de la secousse d'erreur, conservé pour être annulé.
   *
   * Sans cela, le minuteur survit au démontage du composant et appelle
   * `setState` sur un composant mort : un répondant qui quitte l'écran pendant
   * l'animation laisse derrière lui du travail sur un arbre détruit. C'est un
   * test dont l'environnement était démonté qui l'a révélé — l'erreur y était
   * franche (`window is not defined`), alors qu'en production elle passait
   * inaperçue.
   */
  const shakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (shakeTimer.current !== null) clearTimeout(shakeTimer.current);
    },
    [],
  );

  const refuse = useCallback((message: string) => {
    setFieldError(message);
    setShake(true);
    // Deux refus rapprochés : le premier minuteur est annulé, sinon il
    // interromprait la seconde secousse au milieu.
    if (shakeTimer.current !== null) clearTimeout(shakeTimer.current);
    shakeTimer.current = setTimeout(() => {
      shakeTimer.current = null;
      setShake(false);
    }, 400);
  }, []);

  const goBack = useCallback(() => {
    setFieldError(null);
    setDirection('backward');
    if (phase === 'consent') {
      setPhase('form');
      return;
    }
    if (index === 0) {
      setPhase('welcome');
      return;
    }
    setIndex(index - 1);
  }, [index, phase]);

  /**
   * Ramène au premier champ fautif, ou dit lesquels le sont.
   *
   * Un refus ne doit JAMAIS se résumer à « certaines réponses doivent être
   * corrigées » : sur un formulaire de neuf questions, cela laisse chercher.
   * Trois cas, dans l'ordre :
   *
   *  1. le champ fautif est un écran du parcours → on y retourne, message en
   *     ligne et focus posé dessus ;
   *  2. il existe dans le schéma mais n'est plus affiché — un formulaire
   *     modifié pendant la saisie, par exemple → on NOMME la question ;
   *  3. il n'existe même pas dans le schéma → on le dit aussi, plutôt que de
   *     laisser deviner.
   */
  const designate = useCallback(
    (fields: Record<string, string>): boolean => {
      const faulty = Object.keys(fields);
      if (faulty.length === 0) return false;

      const first = faulty[0]!;
      const target = screens.findIndex(
        (screen) => screen.kind === 'field' && screen.field.id === first,
      );
      if (target >= 0) {
        setPhase('form');
        setIndex(target);
        setFieldError(responseErrorMessage(fields[first]!));
        return true;
      }

      const labelled = faulty.map((id) => {
        const known = schema.steps
          .flatMap((step) => step.fields)
          .find((field) => field.id === id);
        const message = responseErrorMessage(fields[id]!);
        return known ? `« ${known.label} » : ${message}` : `« ${id} » : ${message}`;
      });
      setFormError(`${fr.survey.submitErrors.invalid_input} ${labelled.join(' — ')}`);
      return true;
    },
    [schema, screens],
  );

  const send = useCallback(async () => {
    setFormError(null);

    /**
     * Validation de TOUT le formulaire avant l'envoi, avec la même fonction que
     * le serveur.
     *
     * CEINTURE, pas garde-fou agissant : `goNext` refuse déjà de quitter un
     * écran dont le champ est mal rempli, y compris le dernier, si bien qu'on
     * ne peut normalement pas atteindre l'envoi avec une réponse invalide.
     * Muter ce bloc ne fait donc échouer aucun test, et c'est dit ici plutôt
     * que laissé croire.
     *
     * Il reste parce qu'il ne coûte rien et couvre ce que le contrôle écran par
     * écran ne peut pas voir : une incohérence ENTRE deux réponses, ou un
     * changement futur de la navigation. Et parce qu'un refus attrapé ici
     * désigne la question, alors qu'un refus du serveur arrive après l'envoi.
     */
    const validation = validateResponse(schema, answers);
    if (!validation.ok) {
      const fields: Record<string, string> = {};
      for (const error of validation.errors) fields[error.field] ??= error.code;
      designate(fields);
      return;
    }

    setSending(true);
    const result = await onSubmit({ data: answers, consentGiven });

    if (result.ok) {
      setSending(false);
      setPhase('done');
      return;
    }

    setSending(false);

    if (result.fields && designate(result.fields)) return;

    setFormError(submitErrorMessage(result.code));
  }, [answers, consentGiven, designate, onSubmit, schema]);

  const goNext = useCallback(() => {
    if (!current) return;

    if (current.kind === 'field') {
      const error = currentFieldErrors(current.field.id);
      if (error) {
        refuse(error);
        return;
      }
    }

    setDirection('forward');

    if (index + 1 < screens.length) {
      setIndex(index + 1);
      return;
    }

    // Dernier écran : soit le consentement s'intercale, soit on envoie.
    if (consent.required) {
      setPhase('consent');
      return;
    }
    void send();
  }, [current, currentFieldErrors, index, screens.length, consent.required, refuse, send]);

  // Entrée valide l'écran courant, sauf dans une zone de texte multiligne où
  // elle doit rester un saut de ligne.
  const onKeyDown = useCallback(
    (keyEvent: React.KeyboardEvent) => {
      if (keyEvent.key !== 'Enter' || keyEvent.shiftKey) return;
      const target = keyEvent.target as HTMLElement;
      if (target.tagName === 'TEXTAREA') return;
      keyEvent.preventDefault();
      if (phase === 'form') goNext();
    },
    [goNext, phase],
  );

  // Accueil et remerciement passent par la MÊME scène que les questions.
  //
  // Ils en étaient sortis, et n'avaient donc aucune marge horizontale : le
  // texte touchait les bords de l'écran, là où chaque question respirait. Ce
  // n'était pas un réglage à retrouver écran par écran mais une enveloppe
  // manquante — d'où une enveloppe unique, `StandaloneStage`, plutôt qu'un
  // rembourrage recopié dans chaque écran.
  if (phase === 'welcome') {
    return (
      <StandaloneStage>
        <WelcomeScreen
          content={{ ...welcome, branding }}
          onStart={() => {
            setDirection('forward');
            setPhase('form');
          }}
        />
      </StandaloneStage>
    );
  }

  if (phase === 'done') {
    /**
     * DÉFAUT RÉEL signalé en production : l'écran de fin ne regardait pas les
     * réponses. Une personne qui venait de répondre « Non, je ne pourrai pas
     * venir » lisait « Votre inscription est enregistrée », suivie de la date,
     * du lieu, de l'organisateur et d'un lien pour ajouter la soirée à son
     * agenda.
     *
     * Un refus reçoit donc les textes de la plateforme et AUCUN rappel
     * d'événement. Le geste n'est pas symétrique : sans désignation de la
     * question de présence, ou si elle est restée vide, rien ne change — on ne
     * sait pas, et on n'invente pas.
     */
    const declined = hasDeclined(attendance, answers);

    return (
      <StandaloneStage>
        <ThankYouScreen
          title={declined ? thankYou.declined.title : thankYou.title}
          message={declined ? thankYou.declined.message : thankYou.message}
          calendar={declined ? undefined : event?.calendar}
          directions={declined ? undefined : event?.directions}
          eventSummary={declined ? undefined : event?.summary}
        />
      </StandaloneStage>
    );
  }

  const isConsent = phase === 'consent';
  const canSubmit = !consent.required || consentGiven;

  return (
    <div className="sp-runner" onKeyDown={onKeyDown}>
      <div className="sp-progress sp-sticky-top" role="group" aria-label={fr.survey.progress}>
        <div
          className="sp-progress__bar"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={fr.survey.progress}
        >
          <span className="sp-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div
        className={[
          'sp-stage',
          direction === 'forward' ? 'sp-stage--forward' : 'sp-stage--backward',
          shake ? 'sp-stage--shake' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        key={isConsent ? 'consent' : (current?.kind === 'field' ? current.field.id : `intro-${index}`)}
      >
        <div className="sp-stage__focus" ref={headingRef} tabIndex={-1}>
          {formError ? (
            <div style={{ marginBottom: '1rem' }}>
              <Alert tone="error">{formError}</Alert>
            </div>
          ) : null}

          {isConsent ? (
            <ConsentScreen
              notice={consent.notice}
              checkboxLabel={consent.checkboxLabel}
              checked={consentGiven}
              onToggle={setConsentGiven}
              privacyHref={consent.privacyHref}
            />
          ) : current?.kind === 'intro' ? (
            <StepIntroScreen
              title={current.step.title}
              intro={current.step.intro}
              position={`Étape ${current.stepIndex + 1}`}
            />
          ) : current?.kind === 'field' ? (
            <div className="sp-screen">
              <div className="sp-screen__body">
                <FieldInput
                  field={current.field}
                  value={answers[current.field.id]}
                  otherValue={
                    typeof answers[otherKey(current.field.id)] === 'string'
                      ? (answers[otherKey(current.field.id)] as string)
                      : ''
                  }
                  error={fieldError}
                  onChange={setAnswer}
                  autoFocus
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="sp-runner__footer sp-sticky-bottom">
        <button className="sp-btn sp-btn--ghost" type="button" onClick={goBack}>
          {fr.survey.back}
        </button>

        <p className="sp-counter" aria-live="polite">
          {questionScreens.length > 0
            ? fr.survey.questionCounter(Math.max(1, questionNumber), questionScreens.length)
            : ''}
        </p>

        {isConsent ? (
          <button
            className="sp-btn"
            type="button"
            onClick={() => void send()}
            disabled={!canSubmit || sending}
          >
            {sending ? fr.survey.sending : fr.survey.submit}
          </button>
        ) : (
          <button className="sp-btn" type="button" onClick={goNext} disabled={sending}>
            {index + 1 >= screens.length && !consent.required
              ? fr.survey.submit
              : fr.survey.next}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Enveloppe des écrans qui n'ont ni progression ni pied de page : accueil et
 * remerciement.
 *
 * Elle réutilise `sp-runner` et `sp-stage`, donc exactement les marges et le
 * centrage vertical des écrans de question. Les recopier ici les aurait fait
 * diverger au premier ajustement.
 */
function StandaloneStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="sp-runner">
      <div className="sp-stage sp-stage--standalone">{children}</div>
    </div>
  );
}
