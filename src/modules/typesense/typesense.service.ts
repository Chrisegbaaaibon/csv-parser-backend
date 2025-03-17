// src/services/typesense.service.ts
import { Injectable } from '@nestjs/common';
import { TYPESENSE_HOST } from 'src/config/env.config';
import { Client } from 'typesense';

@Injectable()
export class TypesenseService {
  private readonly client: Client;

  constructor() {
    this.client = new Client({
      nodes: [
        {
          host: TYPESENSE_HOST || 'localhost',
          port: 443,
          protocol: 'https',
        },
      ],
      apiKey: process.env.TYPESENSE_API_KEY || '',
      connectionTimeoutSeconds: 2,
    });
  }

  async indexData(collectionName: string, data: any) {
    return this.client.collections(collectionName).documents().create(data);
  }

  async search(collectionName: string, query: string) {
    return this.client.collections(collectionName).documents().search({
      q: query,
      query_by: 'unit_name,phase_name,unit_type',
    });
  }
}
