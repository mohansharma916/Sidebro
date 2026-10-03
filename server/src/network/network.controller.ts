import { Controller, Get } from '@nestjs/common';
import { NetworkService } from './network.service.js';

@Controller('api')
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: Date.now(),
      localIp: this.networkService.getLocalIp(),
      port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    };
  }

  @Get('network')
  getNetwork() {
    return {
      localIp: this.networkService.getLocalIp(),
      clientPort: 5173,
      serverPort: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
    };
  }
}
