import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import { json, urlencoded } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { AppModule } from './app.module.js';
import { NetworkService } from './network/network.service.js';

// Load environment variables across roots
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable Cross-Origin Resource Sharing for local network access (phones & second screens)
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Enable payload limits for high-fidelity base64 audio slice streaming
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Enable native WebSocket adapter on /ws
  app.useWebSocketAdapter(new WsAdapter(app));

  const networkService = app.get(NetworkService);
  const localIp = networkService.getLocalIp();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;

  await app.listen(PORT, '0.0.0.0');

  console.log(`====================================================`);
  console.log(`🚀 SideBro AI — Real-Time NestJS Backend running on:`);
  console.log(`   - Local:     http://localhost:${PORT}`);
  console.log(`   - Network:   http://${localIp}:${PORT}`);
  console.log(`   - WebSocket: ws://${localIp}:${PORT}/ws`);
  console.log(`====================================================`);
}

bootstrap();
