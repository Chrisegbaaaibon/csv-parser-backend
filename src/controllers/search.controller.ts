import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { SearchService } from '../services/search.service';

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  async search(@Query('query') query: string) {
    if (!query) {
      throw new BadRequestException('Search query is required');
    }

    return this.searchService.search(query);
  }
}
