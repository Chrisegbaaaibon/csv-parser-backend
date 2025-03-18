import { Injectable } from '@nestjs/common';
import { TypeSenseConfig } from '../config/typesense.config';
import { PropertyUnit } from '../utils/csv-parser';

@Injectable()
export class SearchService {
  private readonly collectionName = 'property_units';

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
            { name: 'id', type: 'string' },
            { name: 'Unit Name', type: 'string' },
            { name: 'Unit Price', type: 'string' }, // ✅ Ensured as string
            { name: 'Unit Price Numeric', type: 'float' }, // ✅ Numeric field for sorting
            { name: 'Land Area', type: 'float' }, // ✅ Ensured as string
            { name: 'Land Area Numeric', type: 'float' }, // ✅ Numeric field for sorting
            { name: 'Sellable Unit Area', type: 'float' },
          ],
        });
    }
  }

  async indexData(data: PropertyUnit[]) {
    await this.ensureCollection();

    // ✅ Transform the data correctly before indexing
    const enhancedData = data.map((item) => ({
      ...item,
      'Unit Price': parseFloat(String(item['Unit Price'] || '')), // ✅ Always a string
      'Unit Price Numeric': Number(item['Unit Price']) || 0, // ✅ Convert safely
      'Land Area': parseFloat(String(item['Land Area'] || '0')), // Convert to float
      'Land Area Numeric': Number(item['Land Area']) || 0, // ✅ Convert safely
    }));

    await this.typeSenseConfig
      .getClient()
      .collections(this.collectionName)
      .documents()
      .import(enhancedData, { action: 'upsert' }); // ✅ Use upsert to avoid duplicates
  }

  async search(query: string) {
    return await this.typeSenseConfig
      .getClient()
      .collections(this.collectionName)
      .documents()
      .search({
        q: query,
        query_by: 'Unit Name', // ✅ All string fields
      });
  }
}
