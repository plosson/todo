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

export default {
  port: config.port,
  fetch: app.fetch,
};
