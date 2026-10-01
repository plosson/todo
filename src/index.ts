import { loadConfig } from './config';
import { openDatabase } from './db';
import { createServices } from './context';
import { createApp } from './app';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const services = createServices(config, db);
const app = createApp(services);

console.log(`todo listening on ${config.baseUrl} (port ${config.port})`);
console.log(`  google: ${config.google ? 'configured' : 'off'}`);
console.log(`  devAuth: ${config.devAuth ? 'on' : 'off'}`);
console.log(`  db: ${config.databasePath}`);
if (config.google && !config.devAuth && config.allowedEmails.length === 0) {
  console.warn('  WARNING: ALLOWED_EMAILS is empty, so nobody can sign in with Google.');
}

export default {
  port: config.port,
  fetch: app.fetch,
};
