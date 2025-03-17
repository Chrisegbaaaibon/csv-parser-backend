// src/modules/files.module.ts
import { Module } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CsvService } from '../csv/csv.service';
import { TypesenseService } from '../typesense/typesense.service';
import { UploadController } from '../upload/upload.controller';

@Module({
  controllers: [UploadController],
  providers: [SupabaseService, CsvService, TypesenseService],
})
export class UploadModule {}
