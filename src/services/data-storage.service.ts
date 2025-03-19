import { Injectable, Logger } from '@nestjs/common';
import { SupabaseConfig } from '../config/supabase.config';
import { PropertyUnit } from '../utils/csv-parser';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class DataStorageService {
  private readonly logger = new Logger(DataStorageService.name);

  constructor(private readonly supabaseConfig: SupabaseConfig) {}

  async storeData(data: PropertyUnit[]) {
    const adminClient = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_KEY || '',
    );

    const tableName = 'unit';
    const unitNameColumn = this.sanitizeColumnName('Unit Name');

    try {
      const { error: tableError } = await adminClient.rpc('execute_sql', {
        sql: `CREATE TABLE IF NOT EXISTS ${tableName} (
          id UUID DEFAULT gen_random_uuid(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
          ${unitNameColumn} TEXT,
          PRIMARY KEY (id)
        )`,
      });

      if (tableError) {
        this.logger.error(`Failed to create table: ${tableError.message}`);
        throw new Error(`Failed to create table: ${tableError.message}`);
      }

      const { error: constraintError } = await adminClient.rpc('execute_sql', {
        sql: `
          DO $$ 
          BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns 
              WHERE table_name = '${tableName}'
              AND column_name = '${unitNameColumn}'
            ) THEN
              ALTER TABLE ${tableName} ADD COLUMN ${unitNameColumn} TEXT;
            END IF;
          END $$;
          
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
        `,
      });

      if (constraintError) {
        this.logger.error(
          `Failed to add unique constraint: ${constraintError.message}`,
        );
        throw new Error(
          `Failed to add unique constraint: ${constraintError.message}`,
        );
      }

      this.logger.log(`Ensured unique constraint on ${unitNameColumn}`);

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

      const existingColumnNames = tableInfo
        ? tableInfo.map((row) => row[0])
        : [];

      const processedData = data.map((row) => {
        const newRow = {};
        Object.keys(row).forEach((key) => {
          const sanitizedKey = this.sanitizeColumnName(key);
          newRow[sanitizedKey] = row[key];
        });
        return newRow;
      });

      const csvColumnNames = Object.keys(processedData[0]);

      for (const column of csvColumnNames) {
        if (existingColumnNames.includes(column)) {
          continue;
        }

        const columnType = 'TEXT';
        this.logger.log(`Adding column '${column}' with type TEXT`);

        const { error } = await adminClient.rpc('execute_sql', {
          sql: `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS "${column}" ${columnType}`,
        });

        if (error) {
          throw new Error(`Failed to add column '${column}': ${error.message}`);
        }
      }

      const safeData = processedData.map((row) => {
        const safeRow = {};
        Object.keys(row).forEach((key) => {
          safeRow[key] =
            row[key] !== null && row[key] !== undefined
              ? String(row[key])
              : null;
        });
        return safeRow;
      });

      const batchSize = 100;
      for (let i = 0; i < safeData.length; i += batchSize) {
        const batch = safeData.slice(i, i + batchSize);

        const { error } = await adminClient.from(tableName).upsert(batch, {
          onConflict: unitNameColumn,
          ignoreDuplicates: false,
        });

        if (error) {
          this.logger.error(`Batch upsert failed: ${error.message}`);
          throw new Error(`Database upsert failed: ${error.message}`);
        }
      }

      return { success: true, rowCount: data.length };
    } catch (error) {
      this.logger.error(`Storage error: ${error.message}`);
      throw error;
    }
  }

  private sanitizeColumnName(column: string): string {
    return column
      .replace(/\W+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase();
  }
}
