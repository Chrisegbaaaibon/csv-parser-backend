import { Injectable, Logger } from '@nestjs/common';
import { SupabaseConfig } from '../config/supabase.config';

@Injectable()
export class FileStorageService {
  constructor(
    private readonly supabaseConfig: SupabaseConfig,
    private readonly logger: Logger,
  ) {}

  async uploadFile(file: Express.Multer.File): Promise<string> {
    const startTime = Date.now();
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

    const duration = Date.now() - startTime;

    this.logger.log(`File uploaded to ${filePath} in ${duration}ms`);

    return filePath;
  }
}
