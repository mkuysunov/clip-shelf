import type { ClipApi } from '../electron/types';

// Мост из electron/preload.ts
declare global {
  interface Window {
    clip: ClipApi;
  }
}
