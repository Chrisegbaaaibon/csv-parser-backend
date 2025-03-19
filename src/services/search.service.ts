import { Injectable, Logger } from '@nestjs/common';
import { TypeSenseConfig } from '../config/typesense.config';
import { PropertyUnit } from '../utils/csv-parser';
import { SearchParams } from 'typesense/lib/Typesense/Documents';
import { CollectionCreateSchema } from 'typesense/lib/Typesense/Collections';

class SearchCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly TTL = 60000; // 1 minute cache validity

  get(key: string): any {
    const cached = this.cache.get(key);
    if (!cached) return null;

    // Check if cache entry is still valid
    if (Date.now() - cached.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    return cached.data;
  }

  set(key: string, data: any): void {
    // Limit cache size to prevent memory issues
    if (this.cache.size > 100) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

@Injectable()
export class SearchService {
  private readonly collectionName = 'property_units';
  private readonly logger = new Logger(SearchService.name);
  private readonly searchCache = new SearchCache();
  private readonly defaultSearchFields = ['Unit Name', 'Phase: Phase Name']; // Updated default search fields
  private schemaValidated = false;

  constructor(private readonly typeSenseConfig: TypeSenseConfig) {}

  /**
   * Gets the current schema from TypeSense to diagnose issues
   */
  async inspectSchema(): Promise<any> {
    try {
      const collection = await this.typeSenseConfig
        .getClient()
        .collections(this.collectionName)
        .retrieve();
      this.logger.log(`Current schema: ${JSON.stringify(collection, null, 2)}`);
      return collection;
    } catch (error) {
      this.logger.error(
        `Failed to retrieve schema: ${error.message}`,
        error.stack,
      );
      return null;
    }
  }

  /**
   * Resets the collection completely and recreates it with the correct schema based on Excel fields
   */
  async resetCollection(): Promise<boolean> {
    try {
      // Try to delete the collection if it exists
      try {
        await this.typeSenseConfig
          .getClient()
          .collections(this.collectionName)
          .delete();
        this.logger.log('Existing collection deleted successfully');
      } catch (error) {
        this.logger.log(
          `Collection does not exist or could not be deleted: ${error.message}`,
        );
      }
      // Create a fresh collection with only the required fields
      const collectionSchema: CollectionCreateSchema = {
        name: this.collectionName,
        fields: [
          // Only include the fields specified
          { name: 'Unit Name', type: 'string' },
          { name: 'Phase: Phase Name', type: 'string' },
          { name: 'Unit Status', type: 'string' },
          { name: 'Unit Type', type: 'string' },
          { name: 'Unit Price Numeric', type: 'float' },
          { name: 'Land Area Numeric', type: 'float' },
          { name: 'Sellable Unit Area Numeric', type: 'float' },
        ],
        default_sorting_field: 'Unit Price Numeric',
      };

      // Log the schema before creation for debugging
      this.logger.log(
        `Creating collection with schema: ${JSON.stringify(collectionSchema, null, 2)}`,
      );
      await this.typeSenseConfig
        .getClient()
        .collections()
        .create(collectionSchema);
      this.logger.log('Collection created successfully with correct schema');
      this.schemaValidated = true;
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to reset collection: ${error.message}`,
        error.stack,
      );
      return false;
    }
  }

  /**
   * Ensures the collection exists and has the correct schema
   */
  private async ensureCollection(): Promise<boolean> {
    try {
      // Skip validation if already performed
      if (this.schemaValidated) {
        return true;
      }
      // Try to retrieve the collection
      const collection = await this.typeSenseConfig
        .getClient()
        .collections(this.collectionName)
        .retrieve();
      // Validate the schema to ensure it has the required fields
      const fields = collection.fields || [];
      const hasUnitPriceNumeric = fields.some(
        (field) =>
          field.name === 'Unit Price Numeric' && field.type === 'float',
      );
      if (!hasUnitPriceNumeric) {
        this.logger.warn(
          'Schema is missing Unit Price Numeric field, resetting collection',
        );
        return await this.resetCollection();
      }
      this.logger.log('Collection exists with correct schema');
      this.schemaValidated = true;
      return true;
    } catch (error) {
      // Collection doesn't exist, create it
      this.logger.log(`Collection does not exist, creating: ${error.message}`);
      return await this.resetCollection();
    }
  }

  /**
   * Index data into TypeSense with detailed error reporting
   */
  async indexData(data: PropertyUnit[]): Promise<{
    success: boolean;
    totalItems: number;
    successCount: number;
    failedCount: number;
    errors: any[];
  }> {
    const startTime = Date.now();
    this.logger.debug(`Indexing ${data.length} items`);
    try {
      // Ensure collection exists with correct schema
      const collectionReady = await this.ensureCollection();
      if (!collectionReady) {
        return {
          success: false,
          totalItems: data.length,
          successCount: 0,
          failedCount: data.length,
          errors: [
            {
              message: 'Failed to ensure collection exists with correct schema',
            },
          ],
        };
      }

      // Transform the data correctly before indexing
      const enhancedData = data.map((item) => {
        // Create a copy of the item to enhance
        const enhancedItem: any = {
          // Only include the fields we want to index
          'Unit Name': item['Unit Name'],

          'Phase: Phase Name': item['Phase: Phase Name'] || '',
          'Unit Status': item['Unit Status'] || '',
          'Unit Type': item['Unit Type'] || '',

          // Add id field (required by TypeSense)
          id: item['Unit Name'],
        };

        // Add numeric fields for sorting and filtering
        enhancedItem['Unit Price Numeric'] = item['Unit Price']
          ? parseFloat(String(item['Unit Price']).replace(/[^0-9.-]+/g, '')) ||
            0
          : 0;

        enhancedItem['Land Area Numeric'] = item['Land Area']
          ? parseFloat(String(item['Land Area']).replace(/[^0-9.-]+/g, '')) || 0
          : 0;

        enhancedItem['Sellable Unit Area Numeric'] = item['Sellable Unit Area']
          ? parseFloat(
              String(item['Sellable Unit Area']).replace(/[^0-9.-]+/g, ''),
            ) || 0
          : 0;

        return enhancedItem;
      });

      // Continue with import...

      // Log sample of data being indexed (first item)
      if (enhancedData.length > 0) {
        this.logger.debug(
          `Sample item being indexed: ${JSON.stringify(enhancedData[0], null, 2)}`,
        );
      }

      // Import the data with upsert to handle duplicates
      const importResponse = await this.typeSenseConfig
        .getClient()
        .collections(this.collectionName)
        .documents()
        .import(enhancedData, { action: 'upsert' });

      // Count successes and failures
      const successCount = importResponse.filter((item) => item.success).length;
      const failedItems = importResponse.filter((item) => !item.success);

      // Collect detailed error information
      const errors = failedItems.map((item) => ({
        document: item.document,
        error: item.error,
      }));

      // Log errors with more detail
      if (failedItems.length > 0) {
        this.logger.warn(`${failedItems.length} items failed to import`);
        failedItems.slice(0, 5).forEach((item) => {
          this.logger.warn(
            `Import error for document ${item.document?.id || 'unknown'}: ${JSON.stringify(item.error)}`,
          );
        });
      }

      const endTime = Date.now();
      this.logger.debug(
        `Indexing completed in ${endTime - startTime}ms. Success: ${successCount}, Failed: ${failedItems.length}`,
      );

      // Clear cache after updating data
      this.searchCache.clear();

      return {
        success: failedItems.length === 0,
        totalItems: data.length,
        successCount,
        failedCount: failedItems.length,
        errors: errors.slice(0, 1), // Return first 10 errors only to avoid massive response
      };
    } catch (error) {
      const endTime = Date.now();
      this.logger.error(
        `Indexing failed after ${endTime - startTime}ms: ${error.message}`,
        error.stack,
      );

      return {
        success: false,
        totalItems: data.length,
        successCount: 0,
        failedCount: data.length,
        errors: [{ error: error.importResults }],
      };
    }
  }

  /**
   * Update a single document in TypeSense with detailed error reporting
   */
  async updateDocument(
    id: string,
    data: Partial<PropertyUnit>,
  ): Promise<{ success: boolean; error?: any }> {
    const startTime = performance.now();
    this.logger.log(`Updating document in Typesense: ${id}`);
    try {
      // Ensure the collection exists with correct schema
      const collectionReady = await this.ensureCollection();
      if (!collectionReady) {
        return {
          success: false,
          error: {
            message: 'Failed to ensure collection exists with correct schema',
          },
        };
      }

      // Create a copy of the data to enhance - only include fields in our schema
      const enhancedData: any = {};

      // Only copy fields that are part of our schema
      if (data['Unit Name']) enhancedData['Unit Name'] = data['Unit Name'];
      if (data['Phase: Phase Name'])
        enhancedData['Phase: Phase Name'] = data['Phase: Phase Name'];
      if (data['Unit Status'])
        enhancedData['Unit Status'] = data['Unit Status'];
      if (data['Unit Type']) enhancedData['Unit Type'] = data['Unit Type'];

      // Add numeric fields for sorting and filtering if original fields are present
      if (data['Unit Price']) {
        enhancedData['Unit Price Numeric'] =
          parseFloat(String(data['Unit Price']).replace(/[^0-9.-]+/g, '')) || 0;
      }

      if (data['Land Area']) {
        enhancedData['Land Area Numeric'] =
          parseFloat(String(data['Land Area']).replace(/[^0-9.-]+/g, '')) || 0;
      }

      if (data['Sellable Unit Area']) {
        enhancedData['Sellable Unit Area Numeric'] =
          parseFloat(
            String(data['Sellable Unit Area']).replace(/[^0-9.-]+/g, ''),
          ) || 0;
      }

      // Remove undefined values to avoid overwriting with null
      Object.keys(enhancedData).forEach(
        (key) => enhancedData[key] === undefined && delete enhancedData[key],
      );

      // Log the document being updated for debugging
      this.logger.debug(
        `Updating document with data: ${JSON.stringify(enhancedData, null, 2)}`,
      );

      // Update the document in Typesense
      await this.typeSenseConfig
        .getClient()
        .collections(this.collectionName)
        .documents(id)
        .update(enhancedData);

      const duration = performance.now() - startTime;

      // Clear cache after update
      this.searchCache.clear();

      this.logger.log(
        `Document updated successfully in ${duration.toFixed(2)}ms`,
      );
      return { success: true };
    } catch (error) {
      const duration = performance.now() - startTime;
      this.logger.error(
        `Document update failed after ${duration.toFixed(2)}ms: ${error.message}`,
        error.stack,
      );
      return {
        success: false,
        error: {
          message: error.message,
          stack: error.stack,
          details: error.httpStatus
            ? `HTTP ${error.httpStatus}: ${error.serverMessage || 'Unknown server error'}`
            : null,
        },
      };
    }
  }

  /**
   * Perform a search with detailed error handling and fallbacks
   */
  async search(
    query: string,
    options: {
      searchFields?: string[];
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      filterBy?: string;
      perPage?: number;
      page?: number;
      useCache?: boolean;
    } = {},
  ) {
    // Start timing the operation
    const startTime = performance.now();
    let retryCount = 0;
    try {
      // Ensure the collection exists with correct schema
      await this.ensureCollection();

      const {
        searchFields = this.defaultSearchFields,
        sortBy = 'Unit Price Numeric',
        sortOrder = 'asc',
        filterBy,
        perPage = 20,
        page = 1,
        useCache = true,
      } = options;

      // Validate inputs to prevent errors
      const safeQuery = query?.trim() || '*';
      const safeFields = searchFields?.length
        ? searchFields
        : this.defaultSearchFields;

      // Build search parameters
      const searchParams: SearchParams = {
        q: safeQuery,
        query_by: safeFields.join(','),
        sort_by: `${sortBy}:${sortOrder}`,
        per_page: Math.min(perPage, 100), // Cap at 100 for performance
        page: Math.max(page, 1), // Ensure valid page number
      };

      // Add filter if provided
      if (filterBy) {
        searchParams.filter_by = filterBy;
      }

      // Generate cache key based on all parameters
      const cacheKey = JSON.stringify({ q: safeQuery, ...options });

      // Try to get from cache first if enabled
      if (useCache) {
        const cached = this.searchCache.get(cacheKey);
        if (cached) {
          const duration = performance.now() - startTime;
          this.logger.log(
            `Cache hit! Search completed in ${duration.toFixed(2)}ms (from cache)`,
          );
          return cached;
        }
      }

      this.logger.debug(
        `Searching with params: ${JSON.stringify(searchParams)}`,
      );

      // Set a timeout for the request
      const searchPromise = this.typeSenseConfig
        .getClient()
        .collections(this.collectionName)
        .documents()
        .search(searchParams);

      // Add timeout handling
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error('Search timed out after 5 seconds')),
          5000,
        );
      });

      // Race the search against the timeout
      const result = (await Promise.race([searchPromise, timeoutPromise])) as {
        found: number;
        [key: string]: any;
      };

      // Cache the result for future use
      if (useCache) {
        this.searchCache.set(cacheKey, result);
      }

      const endTime = performance.now();
      const duration = endTime - startTime;
      // Log performance metrics
      this.logger.log(
        `Search completed in ${duration.toFixed(2)}ms (${result.found} results found)`,
      );

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      // Handle field not found errors with detailed messaging
      if (
        error.message &&
        error.message.includes('Could not find a field named')
      ) {
        const fieldMatch = error.message.match(
          /Could not find a field named ([^]+)`/,
        );
        const missingField = fieldMatch ? fieldMatch[1] : 'unknown field';

        this.logger.warn(
          `Sort field issue detected: Missing field "${missingField}". ${error.message}`,
        );

        // Provide detailed error message
        const errorDetails = {
          message: `Search failed: ${error.message}`,
          missingField,
          httpStatus: error.httpStatus || 404,
          serverMessage: error.serverMessage || error.message,
        };

        // If first attempt, try to reset collection and retry
        if (retryCount === 0) {
          this.logger.warn(
            `Attempting to reset collection due to missing field "${missingField}"`,
          );
          const resetSuccess = await this.resetCollection();

          if (resetSuccess) {
            this.logger.log('Collection reset successful, retrying search');
            retryCount++;
            return this.search(query, options);
          }

          // Fall back to using Unit Name as sort field
          this.logger.warn(
            `Collection reset unsuccessful, falling back to Unit Name as sort field`,
          );
          const fallbackOptions = {
            ...options,
            sortBy: 'Unit Name',
          };
          retryCount++;
          return this.search(query, fallbackOptions);
        }

        // If retry fails or we've already tried once, throw with detailed info
        throw {
          ...errorDetails,
          suggestion:
            'Check that all fields in your schema match the Excel data exactly. ' +
            "The specific field that's missing is needed for sorting.",
        };
      }

      this.logger.error(
        `Search failed after ${duration.toFixed(2)}ms: ${error.message}`,
        error.stack,
      );

      // Return a detailed error object
      throw {
        message: `Search failed: ${error.message}`,
        httpStatus: error.httpStatus || 500,
        serverMessage: error.serverMessage || error.message,
        stack: error.stack,
        parameters: {
          query,
          options,
        },
        suggestion: 'Check your TypeSense connection and schema configuration.',
      };
    }
  }

  /**
   * Perform a quick search with detailed error handling
   */
  async quickSearch(query: string) {
    const startTime = performance.now();
    try {
      const result = await this.search(query, {
        searchFields: ['Unit Name', 'Unit Status'],
        sortBy: 'Unit Price Numeric',
        sortOrder: 'asc',
        useCache: true,
      });

      const duration = performance.now() - startTime;
      this.logger.log(`Quick search completed in ${duration.toFixed(2)}ms`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      this.logger.error(
        `Quick search failed after ${duration.toFixed(2)}ms: ${error.message}`,
        error.stack,
      );

      // Try fallback search with different sort field
      try {
        this.logger.log('Attempting fallback search with Unit Name sorting');
        const result = await this.search(query, {
          searchFields: ['Unit Name', 'Unit Status'],
          sortBy: 'Unit Name', // Fallback to Unit Name which should always exist
          sortOrder: 'asc',
          useCache: false, // Skip cache for fallback
        });
        return result;
      } catch (fallbackError) {
        // Combine errors for maximum debugging info
        throw {
          originalError: {
            message: error.message,
            serverMessage: error.serverMessage,
            httpStatus: error.httpStatus,
          },
          fallbackError: {
            message: fallbackError.message,
            serverMessage: fallbackError.serverMessage,
            httpStatus: fallbackError.httpStatus,
          },
          suggestion:
            'The search is failing with both the primary sort field and the fallback. Please check your TypeSense schema.',
        };
      }
    }
  }
}
