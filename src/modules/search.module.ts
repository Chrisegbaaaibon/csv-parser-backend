import { Module } from '@nestjs/common';
import { SearchController } from '../controllers/search.controller';
import { SearchService } from '../services/search.service';
import { TypeSenseConfig } from 'src/config/typesense.config';

@Module({
  controllers: [SearchController],
  providers: [SearchService, TypeSenseConfig],
})
export class SearchModule {}
