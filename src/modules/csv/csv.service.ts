import { Injectable } from '@nestjs/common';
import * as csv from 'csv-parser';
import { Readable } from 'stream';

@Injectable()
export class CsvService {
  async parseCsv(fileBuffer: Buffer): Promise<any[]> {
    const results: any[] = [];
    const stream = Readable.from(fileBuffer);

    return new Promise<any[]>((resolve, reject) => {
      stream
        .pipe(csv())
        .on('data', (data: any) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (error) => reject(error));
    });
  }
}
