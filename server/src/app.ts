import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { json, urlencoded } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AppModule } from './app.module.js';
import { isAllowedOrigin } from './common/origin.js';

/** Audio slices arrive base64-encoded; 6 MB comfortably fits a 30 s slice. */
const BODY_LIMIT = '6mb';

export async function createApp(options: { logger?: false } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...(options.logger === false ? { logger: false } : {}),
  });

  // Phones and second screens on the local network may call the API; arbitrary websites may not.
  app.enableCors({
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });

  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: '100kb' }));

  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  serveClientIfBuilt(app);
  return app;
}

/**
 * Serves the built client (client/dist) from the API server when it exists, so the Electron
 * shell (and a single-port deployment) can load the UI over http instead of file://.
 */
function serveClientIfBuilt(app: NestExpressApplication): void {
  const clientDist = process.env.CLIENT_DIST
    ? path.resolve(process.env.CLIENT_DIST)
    : fileURLToPath(new URL('../../client/dist', import.meta.url));
  const indexHtml = path.join(clientDist, 'index.html');
  if (!fs.existsSync(indexHtml)) return;

  app.use(express.static(clientDist, { index: false }));
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    res.sendFile(indexHtml);
  });
}
