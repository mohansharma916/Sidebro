import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createApp } from './app.js';
import { NetworkService } from './network/network.service.js';

// Load environment variables: process cwd first, then server/.env and the repo-root .env
dotenv.config();
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

async function bootstrap() {
  const app = await createApp();

  const localIp = app.get(NetworkService).getLocalIp();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
  const HOST = process.env.HOST || '0.0.0.0';

  await app.listen(PORT, HOST);

  console.log(`====================================================`);
  console.log(`SideBro AI — NestJS backend running on:`);
  console.log(`   - Local:     http://localhost:${PORT}`);
  console.log(`   - Network:   http://${localIp}:${PORT}`);
  console.log(`   - WebSocket: ws://${localIp}:${PORT}/ws`);
  console.log(`====================================================`);
}

bootstrap().catch(err => {
  console.error('Failed to start SideBro backend:', err);
  process.exit(1);
});
