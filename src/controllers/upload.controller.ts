import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '../common/file.interceptor';
import { parseFile } from '../utils/csv-parser';
import { FileStorageService } from '../services/file-storage.service';
import { DataStorageService } from '../services/data-storage.service';
import { SearchService } from '../services/search.service';

@Controller('upload')
export class UploadController {
  constructor(
    private readonly fileStorageService: FileStorageService,
    private readonly dataStorageService: DataStorageService,
    private readonly searchService: SearchService,
  ) {}

  @Post()
  @UseInterceptors(
    new FileInterceptor('file', 1, { limits: { fileSize: 1048576 } }),
  )
  async uploadFile(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    const filePath = await this.fileStorageService.uploadFile(file);
    const parsedData = await parseFile(file);

    await this.dataStorageService.storeData(parsedData.data);
    await this.searchService.indexData(parsedData.data);

    return { message: 'File uploaded & data stored', filePath };
  }
}
