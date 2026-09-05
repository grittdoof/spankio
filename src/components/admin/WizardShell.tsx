import Link from 'next/link';
import { Steps } from '@/components/ui/Steps';
import { WIZARD_TOTAL, stepLabel, stepNumber, type WizardStepKey } from '@/lib/admin/wizard';

/**
 * Coquille d'un écran de parcours guidé.
 *
 * Trois zones fixes, et rien d'autre : l'avancement en haut, UNE question au
 * milieu, la navigation en bas. La constance est le principal apport d'un
 * parcours guidé — si l'action suivante changeait de place d'un écran à
 * l'autre, il faudrait la rechercher à chaque fois, et le gain disparaîtrait.
 *
 * La sortie reste toujours accessible en haut à droite. Un parcours dont on ne
 * peut pas sortir est une impasse, pas un guide.
 */

export interface WizardShellProps {
  step: WizardStepKey;
  /** Titre de l'écran : formulé comme une question posée à l'utilisateur. */
  question: string;
  /** Une ou deux phrases : pourquoi on demande cela, et ce qu'il en advient. */
  lead?: string;
  /** Lien de retour, ou `null` sur le premier écran. */
  backHref: string | null;
  /** Sortie du parcours. */
  exitHref: string;
  exitLabel?: string;
  /** Le formulaire de l'écran : son bouton d'envoi va dans `footer`. */
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function WizardShell({
  step,
  question,
  lead,
  backHref,
  exitHref,
  exitLabel = 'Quitter',
  children,
  footer,
}: WizardShellProps) {
  const current = stepNumber(step);

  return (
    <div className="sp-wizard">
      <div className="sp-wizard__top">
        <div className="sp-wizard__top-inner">
          <Steps current={current} total={WIZARD_TOTAL} label={stepLabel(step)} />
          <Link className="sp-btn sp-btn--ghost sp-btn--sm" href={exitHref}>
            {exitLabel}
          </Link>
        </div>
      </div>

      <main className="sp-wizard__body" id="contenu">
        <div className="sp-ask">
          <span className="sp-ask__step">
            Étape {current} sur {WIZARD_TOTAL}
          </span>
          <h1 className="sp-ask__title">{question}</h1>
          {lead ? <p className="sp-ask__lead">{lead}</p> : null}
          <div className="sp-ask__body">{children}</div>
        </div>
      </main>

      <div className="sp-wizard__foot">
        <div className="sp-wizard__foot-inner">
          {backHref ? (
            <Link className="sp-btn sp-btn--ghost" href={backHref}>
              Retour
            </Link>
          ) : (
            <span />
          )}
          {footer}
        </div>
      </div>
    </div>
  );
}
