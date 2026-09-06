'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from '@/components/ui/Alert';
import { fr, responseErrorMessage, submitErrorMessage } from '@/lib/i18n/fr';
import type { ConsentNotice } from '@/lib/survey/consent';
import { visibleFields, visibleSteps } from '@/lib/survey/conditions';
import { otherKey, type SurveyField, type SurveySchema, type SurveyStep } from '@/lib/survey/schema';
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
  welcome: {
    badge?: string | undefined;
    title: string;
    description?: string | undefined;
    meta?: readonly string[];
    ctaLabel: string;
  };
  consent: { required: boolean; notice: ConsentNotice; checkboxLabel: string; privacyHref: string };
  thankYou: { title: string; message?: string | undefined };
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

  const send = useCallback(async () => {
    setSending(true);
    setFormError(null);

    const result = await onSubmit({ data: answers, consentGiven });

    if (result.ok) {
      setSending(false);
      setPhase('done');
      return;
    }

    setSending(false);

    // Un refus portant sur un champ ramène à CE champ : laisser l'utilisateur
    // chercher lui-même serait cruel sur un formulaire long.
    const firstFaulty = result.fields ? Object.keys(result.fields)[0] : undefined;
    if (firstFaulty) {
      const target = screens.findIndex(
        (screen) => screen.kind === 'field' && screen.field.id === firstFaulty,
      );
      if (target >= 0) {
        setPhase('form');
        setIndex(target);
        setFieldError(responseErrorMessage(result.fields![firstFaulty]!));
        return;
      }
    }

    setFormError(submitErrorMessage(result.code));
  }, [answers, consentGiven, onSubmit, screens]);

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

  if (phase === 'welcome') {
    return (
      <WelcomeScreen
        branding={branding}
        badge={welcome.badge}
        title={welcome.title}
        description={welcome.description}
        meta={welcome.meta}
        ctaLabel={welcome.ctaLabel}
        onStart={() => {
          setDirection('forward');
          setPhase('form');
        }}
        // Bloquer la date est souvent le premier geste d'un destinataire
        // d'invitation ; s'inscrire vient ensuite. L'agenda et l'itinéraire
        // sont donc offerts dès l'accueil, pas seulement après l'envoi.
        {...(event ? { event: { calendar: event.calendar, directions: event.directions } } : {})}
      />
    );
  }

  if (phase === 'done') {
    return (
      <ThankYouScreen
        title={thankYou.title}
        message={thankYou.message}
        calendar={event?.calendar}
        directions={event?.directions}
        eventSummary={event?.summary}
      />
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
