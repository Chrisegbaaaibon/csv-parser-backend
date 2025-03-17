import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import * as Busboy from 'busboy';
import { Limits } from 'busboy';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { Readable } from 'stream';

type FileInterceptorOptions = {
  limits?: Limits;
};

@Injectable()
export class FileInterceptor implements NestInterceptor {
  constructor(
    private fieldName: string,
    private maxCount?: number,
    private options: FileInterceptorOptions = {},
  ) {}
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<any> | Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();

    return new Promise((resolve, reject) => {
      const busboy = Busboy({
        headers: request.headers,
        // 10Mb by default
        limits: this.options.limits ?? { fileSize: 1024 * 1024 * 10 },
      });
      const fields: {
        [x: string]: string;
      } = {};

      const files: (Partial<Express.Multer.File> & { id?: string })[] = [];
      let count = 0;

      busboy.on(
        'file',
        (
          name: string,
          file: Readable,
          information: { filename: string; encoding: string; mimeType: string },
        ): void => {
          const id = randomUUID();
          if (name !== this.fieldName) {
            file.resume();
            return;
          }

          if (
            typeof this.maxCount !== 'undefined' &&
            count++ >= this.maxCount
          ) {
            file.resume();
            throw new BadRequestException('Too many files...');
          }

          file.on('data', (data: any) => {
            const file = files.find((v) => v.id === id);
            if (file) {
              file.buffer = Buffer.concat([file.buffer, data]);
              file.size = (file.size as number) + data.length;
            } else {
              files.push({
                id,
                fieldname: name,
                originalname: information.filename,
                encoding: information.encoding,
                mimetype: information.mimeType,
                size: data.length,
                buffer: data,
              });
            }
          });
        },
      );

      busboy.on('field', (name, value) => {
        fields[name] = value;
      });

      busboy.on('finish', () => {
        request.body = fields;
        const data = files.map((file) => {
          delete file.id;
          // file.stream = new Readable();
          // file.stream.push(file.buffer);
          return file;
        });

        // Compatibility with Nest.Js Decorator
        if (this.maxCount === 1) request.file = data[0];
        else request.files = data;

        resolve(next.handle());
      });

      busboy.on('error', (err) => {
        reject(err);
      });

      // Cloud environment
      if (request.rawBody) busboy.end(request.rawBody);
      // Standalone or test environment
      else request.pipe(busboy);
    });
  }
}
