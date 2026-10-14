import { Injectable } from '@nestjs/common';
import os from 'os';

@Injectable()
export class NetworkService {
  private localIp: string;

  constructor() {
    this.localIp = this.detectLocalIp();
  }

  public getLocalIp(): string {
    return this.detectLocalIp();
  }

  private detectLocalIp(): string {
    // Inside Docker the interfaces are container-internal, so allow the host's LAN IP to be passed in
    if (process.env.HOST_IP) return process.env.HOST_IP;

    const interfaces = os.networkInterfaces();
    for (const ifaceName of Object.keys(interfaces)) {
      const addresses = interfaces[ifaceName];
      if (addresses) {
        for (const addr of addresses) {
          if (addr.family === 'IPv4' && !addr.internal) {
            return addr.address;
          }
        }
      }
    }
    return '127.0.0.1';
  }
}
