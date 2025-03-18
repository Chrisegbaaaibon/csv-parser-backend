import { Injectable, Logger } from '@nestjs/common';
import { SupabaseConfig } from '../config/supabase.config';
import { PropertyUnit } from '../utils/csv-parser';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class DataStorageService {
  private readonly logger = new Logger(DataStorageService.name);

  constructor(private readonly supabaseConfig: SupabaseConfig) {}

  async storeData(data: PropertyUnit[]) {
    // Create a new client with the service role key
    const adminClient = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_KEY || '', // Changed to SERVICE_ROLE_KEY
    );

    const tableName = 'unit';

    try {
      // 1️⃣ Create the table directly with SQL
      const { error: tableError } = await adminClient.rpc('execute_sql', {
        sql: `CREATE TABLE IF NOT EXISTS ${tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
        )`,
      });

      if (tableError) {
        this.logger.error(`Failed to create table: ${tableError.message}`);
        throw new Error(`Failed to create table: ${tableError.message}`);
      }

      // 2️⃣ Fetch existing column names with SQL query
      const { data: tableInfo, error: fetchError } = await adminClient.rpc(
        'execute_sql',
        {
          sql: `SELECT column_name 
              FROM information_schema.columns 
              WHERE table_name = '${tableName}' 
              AND table_schema = 'public'`,
        },
      );

      if (fetchError) {
        throw new Error(`Failed to fetch table schema: ${fetchError.message}`);
      }

      // Parse the column names from the result
      const existingColumnNames = tableInfo
        ? tableInfo.map((row) => row[0])
        : [];

      // 3️⃣ Process data to sanitize column names for SQL
      const processedData = data.map((row) => {
        const newRow = {};
        Object.keys(row).forEach((key) => {
          const sanitizedKey = this.sanitizeColumnName(key);
          newRow[sanitizedKey] = row[key];
        });
        return newRow;
      });

      // 4️⃣ Get column names from sanitized CSV data
      const csvColumnNames = Object.keys(processedData[0]);

      // 5️⃣ Create missing columns with direct SQL - ALWAYS USE TEXT TYPE TO AVOID CONVERSION ERRORS
      for (const column of csvColumnNames) {
        // Skip columns that already exist
        if (existingColumnNames.includes(column)) {
          continue;
        }

        // Now we're using TEXT for all columns to be safe
        const columnType = 'TEXT'; // Use TEXT for all columns to avoid type conversion errors
        this.logger.log(`Adding column '${column}' with type TEXT`);

        // Execute alter table SQL directly
        const { error } = await adminClient.rpc('execute_sql', {
          sql: `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${column}" ${columnType}`,
        });

        if (error) {
          throw new Error(`Failed to add column '${column}': ${error.message}`);
        }
      }

      // 6️⃣ Convert all values to strings to ensure they can be inserted
      const safeData = processedData.map((row) => {
        const safeRow = {};
        Object.keys(row).forEach((key) => {
          // Convert all values to strings to avoid type issues
          safeRow[key] =
            row[key] !== null && row[key] !== undefined
              ? String(row[key])
              : null;
        });
        return safeRow;
      });

      // 7️⃣ Insert processed data in batches
      const batchSize = 100;
      for (let i = 0; i < safeData.length; i += batchSize) {
        const batch = safeData.slice(i, i + batchSize);
        const { error } = await adminClient.from(tableName).insert(batch);
        if (error) {
          this.logger.error(`Batch insert failed: ${error.message}`);
          throw new Error(`Database insert failed: ${error.message}`);
        }
      }

      return { success: true, rowCount: data.length };
    } catch (error) {
      this.logger.error(`Storage error: ${error.message}`);
      throw error;
    }
  }

  private sanitizeColumnName(column: string): string {
    // Replace spaces and special characters with underscores
    return column
      .replace(/\W+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }

  // This method is no longer used since we're using TEXT for all columns
  private determineColumnType(data: any[], column: string): string {
    // Check more values (up to 100) to better determine type
    const samples = data
      .filter((row) => row[column] !== null && row[column] !== undefined)
      .slice(0, 100);

    if (samples.length === 0) return 'TEXT';

    // Check if ALL values are numeric
    const allNumbers = samples.every((row) => {
      const val = row[column];

      if (typeof val === 'number') return true;

      if (typeof val !== 'string') return false;

      // Make sure the entire string is a valid number
      const trimmed = val.trim();
      return (
        trimmed !== '' &&
        !isNaN(Number(trimmed)) &&
        /^-?\d+(\.\d+)?$/.test(trimmed)
      );
    });

    return allNumbers ? 'NUMERIC' : 'TEXT';
  }
}
