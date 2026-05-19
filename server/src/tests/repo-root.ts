import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Monorepo root when tests live in `server/src/tests`. */
export const MAMBA_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
