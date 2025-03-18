import { Injectable } from '@nestjs/common';
import { SupabaseConfig } from '../config/supabase.config';

@Injectable()
export class FileStorageService {
  constructor(private readonly supabaseConfig: SupabaseConfig) {}

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const supabase = this.supabaseConfig.getClient();
    const filePath = `uploads/${Date.now()}_${file.originalname}`;

    const { error } = await supabase.storage
      .from('csv-files')
      .upload(filePath, file.buffer, {
        contentType: file.mimetype,
      });

    if (error) {
      throw new Error(`File upload failed: ${error.message}`);
    }

    return filePath;
  }
}
