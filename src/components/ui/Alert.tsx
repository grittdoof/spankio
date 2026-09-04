/**
 * Message d'état.
 *
 * `role="alert"` pour une erreur (interrompt le lecteur d'écran, c'est
 * justifié), `role="status"` pour une confirmation (annoncée sans couper).
 * La couleur n'est jamais le seul porteur d'information : le texte suffit.
 */
export interface AlertProps {
  tone: 'error' | 'success' | 'info';
  title?: string;
  children: React.ReactNode;
}

const TONE_CLASS: Record<AlertProps['tone'], string> = {
  error: 'sp-alert--error',
  success: 'sp-alert--success',
  info: 'sp-alert--info',
};

export function Alert({ tone, title, children }: AlertProps) {
  return (
    <div
      className={`sp-alert ${TONE_CLASS[tone]}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {title ? <p className="sp-alert__title">{title}</p> : null}
      <div className="sp-alert__body">{children}</div>
    </div>
  );
}
