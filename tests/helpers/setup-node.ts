import { beforeEach } from 'vitest';
import { setLogSink } from '@/lib/logger';

/**
 * Les tests ne doivent pas polluer la sortie avec les journaux applicatifs.
 * Les tests qui vérifient la journalisation installent leur propre puits.
 */
beforeEach(() => {
  setLogSink(() => {});
});
