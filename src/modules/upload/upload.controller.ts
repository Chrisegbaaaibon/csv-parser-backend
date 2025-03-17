// src/controllers/files.controller.ts
import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  Get,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '../../common/file.interceptor';
import { SupabaseService } from '../supabase/supabase.service';
import { CsvService } from '../csv/csv.service';
import { TypesenseService } from '../typesense/typesense.service';

@Controller('files')
export class UploadController {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly csvService: CsvService,
    private readonly typesenseService: TypesenseService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    new FileInterceptor('file', 1, { limits: { fileSize: 1024 * 1024 * 50 } }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    const filePath = `uploads/${Date.now()}-${file.originalname}`;

    // Upload file to Supabase Storage
    await this.supabaseService.uploadFile('csv-files', filePath, file.buffer);

    // Store file metadata in Supabase Database
    await this.supabaseService.storeFileMetadata(filePath);

    // Parse CSV file
    const csvData = await this.csvService.parseCsv(file.buffer);


    // Insert CSV data into Supabase Database
    await this.supabaseService.insertData('units', csvData);

    // Index CSV data in Typesense
    for (const record of csvData) {
      await this.typesenseService.indexData('units', record);
    }

    return {
      message: 'File uploaded and data indexed successfully',
      filePath,
    };
  }

  @Get('data')
  async getPaginatedData(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    if (isNaN(page)) page = 1;
    if (isNaN(limit)) limit = 10;

    // Fetch paginated data from Supabase
    const data = await this.supabaseService.getPaginatedData(
      'units',
      page,
      limit,
    );

    return {
      page,
      limit,
      data,
    };
  }
}
