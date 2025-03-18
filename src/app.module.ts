import { Module } from '@nestjs/common';
import { UploadModule } from './modules/upload.module';
import { SearchModule } from './modules/search.module';

@Module({
  imports: [UploadModule, SearchModule],
})
export class AppModule {}
