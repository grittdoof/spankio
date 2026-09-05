import Link from 'next/link';
import { BrandMark } from '@/components/ui/BrandMark';
import { fr } from '@/lib/i18n/fr';

/**
 * Cadre commun des écrans d'authentification.
 *
 * Le `<main>` porte l'ancre du lien d'évitement, et les liens légaux sont
 * présents dès l'écran de connexion : les mentions et la politique de
 * confidentialité doivent être atteignables sans compte.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="sp-auth" id="contenu">
      <div className="sp-auth__inner">
        <p className="sp-auth__brand">
          <BrandMark className="sp-auth__mark" name={fr.platform.name} />
          {fr.platform.name}
        </p>
        <div className="sp-card">
          <h1 className="sp-auth__title">{title}</h1>
          {description ? <p className="sp-auth__description">{description}</p> : null}
          {children}
          {footer ? <div className="sp-auth__footer">{footer}</div> : null}
        </div>
        <p className="sp-auth__legal">
          <Link href="/mentions-legales">{fr.nav.legalNotice}</Link>
          {' · '}
          <Link href="/confidentialite">{fr.nav.privacy}</Link>
        </p>
      </div>
    </main>
  );
}
