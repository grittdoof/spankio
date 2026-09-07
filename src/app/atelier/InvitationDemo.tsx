'use client';

import { Invitation, type InvitationProps } from '@/components/public/Invitation';

/**
 * Enveloppe cliente de l'invitation de démonstration.
 *
 * Elle existe pour une raison précise : l'atelier est un composant SERVEUR, et
 * une fonction ne traverse pas la frontière serveur/client. Le bouton
 * d'inscription a besoin d'un gestionnaire ; il est donc fourni ici, du côté
 * client, plutôt qu'en rendant `onStart` optionnel — un appel à l'action sans
 * effet serait un mensonge de plus dans un catalogue censé montrer le vrai.
 */
export function InvitationDemo({
  content,
}: {
  content: Omit<InvitationProps, 'onStart'>;
}) {
  return <Invitation {...content} onStart={() => {}} />;
}
