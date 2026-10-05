import { createApiClient } from '../api/client';
import { authSource } from '../auth/auth';
import { config } from '../config';
import { createDocumentSession, type SessionStorage } from './session';

/** The one API client and the one document session of this tab. */
export const api = createApiClient({ baseUrl: config.apiUrl, auth: authSource });

const storage: SessionStorage = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage full or blocked: drafts then live only in memory */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

export const session = createDocumentSession({ api, storage });
