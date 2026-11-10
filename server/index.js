import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try { await app.close(); process.exit(0); }
    catch (error) { app.log.error(error); process.exit(1); }
  });
}
