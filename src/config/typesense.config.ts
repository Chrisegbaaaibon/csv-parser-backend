import { Injectable } from '@nestjs/common';
import { Client } from 'typesense';
import * as dotenv from 'dotenv';
import {
  TYPESENSE_API_KEY,
  TYPESENSE_HOST,
  TYPESENSE_PORT,
  TYPESENSE_PROTOCOL,
} from './env.config';

dotenv.config();

@Injectable()
export class TypeSenseConfig {
  private readonly client: Client;

  constructor() {
    this.client = new Client({
      nodes: [
        {
          host: TYPESENSE_HOST!,
          port: TYPESENSE_PORT!,
          protocol: TYPESENSE_PROTOCOL!,
        },
      ],
      apiKey: TYPESENSE_API_KEY!,
      connectionTimeoutSeconds: 10,
    });
  }

  getClient(): Client {
    return this.client;
  }
}
