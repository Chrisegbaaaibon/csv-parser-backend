import { Logger, Module } from '@nestjs/common';
import { UploadController } from '../controllers/upload.controller';
import { FileStorageService } from '../services/file-storage.service';
import { DataStorageService } from '../services/data-storage.service';
import { SearchService } from '../services/search.service';
import { SupabaseConfig } from 'src/config/supabase.config';
import { TypeSenseConfig } from 'src/config/typesense.config';

@Module({
  controllers: [UploadController],
  providers: [
    FileStorageService,
    DataStorageService,
    SearchService,
    SupabaseConfig,
    TypeSenseConfig,
    Logger,
  ],
})
export class UploadModule {}
