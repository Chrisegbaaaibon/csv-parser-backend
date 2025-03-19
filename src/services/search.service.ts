import { Injectable, Logger } from '@nestjs/common';
import { TypeSenseConfig } from '../config/typesense.config';
import { PropertyUnit } from '../utils/csv-parser';

@Injectable()
export class SearchService {
  private readonly collectionName = 'property_units';
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly typeSenseConfig: TypeSenseConfig) {}

  private async ensureCollection() {
    try {
      await this.typeSenseConfig
        .getClient()
        .collections(this.collectionName)
        .retrieve();
    } catch {
      await this.typeSenseConfig
        .getClient()
        .collections()
        .create({
          name: this.collectionName,
          fields: [
            { name: 'Unit Name', type: 'string' },
            { name: 'Unit Price', type: 'string' },
            { name: 'Unit Price Numeric', type: 'float' },
            { name: 'Land Area', type: 'float' },
            { name: 'Land Area Search', type: 'string' },
            { name: 'Sellable Unit Area', type: 'float' },
          ],
          default_sorting_field: 'Unit Price Numeric',
        });
    }
  }

  async indexData(data: PropertyUnit[]) {
    await this.ensureCollection();
  
    // Transform the data correctly before indexing
    const enhancedData = data.map((item) => {
      if (!item['Unit Name']) {
        this.logger.warn('Found item without Unit Name, generating random ID');
      }
  
      return {
        id:
          item['Unit Name'] ||
          `unit-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        ...item,
        'Unit Price Search': String(item['Unit Price'] || ''),
        'Unit Price Numeric': parseFloat(item['Unit Price']) || 0,
        'Land Area Search': String(item['Land Area'] || '0'),
        'Land Area': parseFloat(String(item['Land Area'])) || 0,
      };
    });
  
    await this.typeSenseConfig
      .getClient()
      .collections(this.collectionName)
      .documents()
      .import(enhancedData, { action: 'upsert' });
  }

  async search(
    query: string,
    options: {
      searchFields?: string[];
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      filterBy?: string;
      perPage?: number;
      page?: number;
    } = {},
  ) {
    const {
      searchFields = ['Unit Name'],
      sortBy = 'Unit Price',
      sortOrder = 'asc',
      filterBy,
      perPage = 20,
      page = 1,
    } = options;

    // Build search parameters
    const searchParams = {
      q: query,
      query_by: searchFields.join(','),
      sort_by: `${sortBy}:${sortOrder}`,
      per_page: perPage,
      page,
    };

    // Add filter if provided
    if (filterBy) {
      searchParams['filter_by'] = filterBy;
    }

    this.logger.debug(`Searching with params: ${JSON.stringify(searchParams)}`);

    return await this.typeSenseConfig
      .getClient()
      .collections(this.collectionName)
      .documents()
      .search(searchParams);
  }

  async quickSearch(query: string) {
    return this.search(query, {
      searchFields: ['Unit Name', 'Unit Price Search', 'Land Area Search', 'Sellable Unit Area'],
      sortBy: 'Unit Price Numeric',
      sortOrder: 'asc',
    });
  }
}
