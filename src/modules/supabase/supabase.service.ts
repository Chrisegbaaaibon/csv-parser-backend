// src/services/supabase.service.ts
import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_KEY || '',
      {
        auth:{
          persistSession: false,
        }
      },
    );
  }

  async uploadFile(bucketName: string, filePath: string, file: Buffer) {
    const { data, error } = await this.supabase.storage
      .from(bucketName)
      .upload(filePath, file);

    if (error) throw new Error(error.message);
    return data;
  }

  async insertData(tableName: string, data: any) {
    const { data: result, error } = await this.supabase
      .from(tableName)
      .insert(data);

    if (error) throw new Error(error.message);
    return result;
  }

  async storeFileMetadata(filePath: string) {
    const { data, error } = await this.supabase
      .from('file_metadata')
      .insert([{ file_path: filePath }]);

    if (error) throw new Error(error.message);
    return data;
  }

  async getPaginatedData(tableName: string, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const { data, error } = await this.supabase
      .from(tableName)
      .select('*')
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);
    return data;
  }
}
