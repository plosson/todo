import type { Database } from 'bun:sqlite';
import type { Config } from './config';
import { AuthService } from './auth/service';
import { DeviceFlowService } from './auth/device-flow';
import { TodoService } from './todos';
import type { GoogleClient } from './auth/google';
import { createGoogleClient } from './auth/google';

export interface AppServices {
  config: Config;
  db: Database;
  auth: AuthService;
  devices: DeviceFlowService;
  todos: TodoService;
  google: GoogleClient | null;
}

export function createServices(config: Config, db: Database): AppServices {
  const auth = new AuthService(db, {
    allowedEmails: config.allowedEmails,
    allowAnyEmail: config.devAuth,
  });
  return {
    config,
    db,
    auth,
    devices: new DeviceFlowService(db, auth, config.baseUrl),
    todos: new TodoService(db),
    google: config.google ? createGoogleClient(config.google) : null,
  };
}

export type AppEnv = {
  Variables: {
    services: AppServices;
    principal: import('./auth/service').Principal | null;
  };
};
