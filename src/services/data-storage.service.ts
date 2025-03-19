import { Injectable, Logger } from '@nestjs/common';
import { SupabaseConfig } from '../config/supabase.config';
import { PropertyUnit } from '../utils/csv-parser';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SearchService } from './search.service';

// Interface for processed data
interface ProcessedData {
  [key: string]: string | null;
}

@Injectable()
export class DataStorageService {
  private readonly logger = new Logger(DataStorageService.name);
  private adminClient: SupabaseClient;

  constructor(
    private readonly supabaseConfig: SupabaseConfig,
    private readonly searchService: SearchService,
  ) {
    // Initialize the admin client once during service instantiation
    this.adminClient = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_KEY || '',
    );
  }

  /**
   * Stores multiple property units in the database
   */
  async storeData(
    data: PropertyUnit[],
  ): Promise<{ success: boolean; rowCount: number }> {
    if (!data || !data.length) {
      return { success: true, rowCount: 0 };
    }

    const startTime = performance.now();
    this.logger.log(`Starting optimized storage for ${data.length} items`);

    const tableName = 'unit';
    const unitNameColumn = this.sanitizeColumnName('Unit Name');

    try {
      // 1️⃣ PARALLEL OPERATION: Create table and check columns in parallel
      const [tableCreation, columnsFetch] = await Promise.all([
        // Create table with one SQL operation
        this.executeSql(`
          -- Create table if not exists
          CREATE TABLE IF NOT EXISTS ${tableName} (
            id UUID DEFAULT gen_random_uuid(),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            ${unitNameColumn} TEXT,
            PRIMARY KEY (id)
          );
          
          -- Add unique constraint in single transaction
          DO $$
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_constraint
              WHERE conname = '${tableName}_${unitNameColumn}_key'
              AND contype = 'u'
            ) THEN
              ALTER TABLE ${tableName} ADD CONSTRAINT ${tableName}_${unitNameColumn}_key UNIQUE (${unitNameColumn});
            END IF;
          END $$;
          
          -- Create index for better search performance
          CREATE INDEX IF NOT EXISTS idx_${tableName}_${unitNameColumn} ON ${tableName}(${unitNameColumn});
        `),

        // Fetch existing columns in parallel
        this.executeSql(`
          SELECT column_name FROM information_schema.columns 
          WHERE table_name = '${tableName}' AND table_schema = 'public'
        `),
      ]);

      // 2️⃣ COLUMN CREATION: Efficiently process data in one pass and add missing columns
      const existingColumns = columnsFetch.data
        ? columnsFetch.data.map((row) => row[0])
        : [];

      // Process data once to extract all columns and values efficiently
      const allColumns = new Set<string>();
      const processedData: ProcessedData[] = data.map((row) => {
        const newRow: ProcessedData = {};

        Object.keys(row).forEach((key) => {
          const sanitizedKey = this.sanitizeColumnName(key);
          newRow[sanitizedKey] =
            row[key] !== null && row[key] !== undefined
              ? String(row[key])
              : null;
          allColumns.add(sanitizedKey);
        });

        return newRow;
      });

      // 3️⃣ BATCH COLUMN CREATION: Create missing columns in a SINGLE SQL operation
      const missingColumns = [...allColumns].filter(
        (col) => !existingColumns.includes(col),
      );

      if (missingColumns.length) {
        const columnAdditions = missingColumns
          .map((col) => `ADD COLUMN IF NOT EXISTS "${col}" TEXT`)
          .join(', ');

        await this.executeSql(`ALTER TABLE ${tableName} ${columnAdditions};`);
        this.logger.log(
          `Added ${missingColumns.length} new columns in one operation`,
        );
      }

      // 4️⃣ OPTIMIZED BATCHING: Insert with transaction for better performance
      const batchSize = 500;
      const concurrencyLimit = 3; // Adjust based on your database capacity
      const results: any[] = [];

      // Create batches of data with proper typing
      const batches: ProcessedData[][] = [];
      for (let i = 0; i < processedData.length; i += batchSize) {
        batches.push(processedData.slice(i, i + batchSize));
      }

      // Process batches with concurrency control
      for (let i = 0; i < batches.length; i += concurrencyLimit) {
        const currentBatchPromises = batches
          .slice(i, i + concurrencyLimit)
          .map((batch) =>
            this.adminClient
              .from(tableName)
              .upsert(batch, {
                onConflict: unitNameColumn,
                ignoreDuplicates: false,
              })
              .then((result) => {
                if (result.error) {
                  throw result.error;
                }
                return result;
              }),
          );

        // Wait for the current batch of promises to complete
        const batchResults = await Promise.allSettled(currentBatchPromises);

        // Check for and handle errors
        const errors = batchResults
          .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
          .map((r) => r.reason);

        if (errors.length) {
          this.logger.error(
            `Batch errors: ${errors.map((e) => e.message).join(', ')}`,
          );
          throw new Error(`Database upsert had ${errors.length} failures`);
        }

        // Fixed type issue with proper type guard
        const successfulResults = batchResults
          .filter(
            (r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled',
          )
          .map((r) => r.value)
          .filter(Boolean);

        results.push(...successfulResults);
      }

      // 6️⃣ SEARCH INDEXING: Do this in background without blocking response
      this.searchService
        .indexData(data)
        .then(() => this.logger.log('Background indexing completed'))
        .catch((err) =>
          this.logger.error(`Background indexing failed: ${err.message}`),
        );

      const duration = performance.now() - startTime;
      this.logger.log(
        `✅ Optimized storage completed in ${duration.toFixed(1)}ms for ${data.length} records`,
      );

      return { success: true, rowCount: data.length };
    } catch (error) {
      const duration = performance.now() - startTime;
      this.logger.error(
        `❌ Storage error after ${duration.toFixed(1)}ms: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Edits a single property unit by ID
   */
  async editData(
    id: string,
    body: Partial<PropertyUnit>,
  ): Promise<{ data: PropertyUnit | null; error: any }> {
    const startTime = performance.now();
    this.logger.log(`Starting edit operation for unit: ${id}`);

    try {
      // Sanitize column names in the input body to match database expectations
      const sanitizedData: ProcessedData = {};
      Object.keys(body).forEach((key) => {
        const sanitizedKey = this.sanitizeColumnName(key);
        sanitizedData[sanitizedKey] =
          body[key] != null ? String(body[key]) : null;
      });

      // First check if the record exists to avoid unnecessary update operations
      const { data: existingRecord, error: lookupError } =
        await this.adminClient
          .from('unit')
          .select('unit_name')
          .match({ unit_name: id })
          .single();

      this.logger.log(`Existing record: ${JSON.stringify(existingRecord)}`);

      if (lookupError) {
        this.logger.error(`Error looking up record: ${lookupError.message}`);
        return { data: null, error: lookupError };
      }

      if (!existingRecord) {
        this.logger.warn(`Record with unit_name=${id} not found`);
        return { data: null, error: { message: 'Record not found' } };
      }

      // Update the database record
      const { data, error } = await this.adminClient
        .from('unit')
        .update(sanitizedData)
        .match({ unit_name: id })
        .select()
        .single();

      if (error) {
        const duration = performance.now() - startTime;
        this.logger.error(
          `Update error (${duration.toFixed(1)}ms): ${error.message}`,
        );
        return { data: null, error };
      }

      // If database update was successful, also update Typesense
      // Update the document in Typesense
      this.searchService
        .updateDocument(id, body)
        .then(({ success, error: typesenseError }) => {
          if (!success) {
            this.logger.warn(
              `Database updated but Typesense update failed: ${typesenseError?.message}`,
            );
          }
        })
        .catch((err) => {
          this.logger.warn(`Typesense update error: ${err.message}`);
        });

      const duration = performance.now() - startTime;
      this.logger.log(
        `Update completed in ${duration.toFixed(1)}ms for unit: ${id}`,
      );
      return { data, error: null };
    } catch (error) {
      const duration = performance.now() - startTime;
      this.logger.error(
        `Unexpected error (${duration.toFixed(1)}ms): ${error.message}`,
      );
      return { data: null, error };
    }
  }

  /**
   * Helper method to sanitize column names
   */
  private sanitizeColumnName(column: string): string {
    return column
      .replace(/\W+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  /**
   * Helper method to execute SQL with error handling
   */
  private async executeSql(sql: string): Promise<any> {
    const { data, error } = await this.adminClient.rpc('execute_sql', { sql });

    if (error) {
      this.logger.error(`SQL execution error: ${error.message}`);
      throw new Error(`SQL execution failed: ${error.message}`);
    }

    return { data, error };
  }
}
