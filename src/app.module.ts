import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  SUPABASE_DB_HOST,
  SUPABASE_DB_NAME,
  SUPABASE_USER_NAME,
  SUPABASE_USER_PASSWORD,
} from './config/env.config';
import { UploadModule } from './modules/upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: SUPABASE_DB_HOST,
      port: 5432,
      username: SUPABASE_USER_NAME,
      password: SUPABASE_USER_PASSWORD,
      database: SUPABASE_DB_NAME,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: false,
      ssl: {
        rejectUnauthorized: false,
      },
    }),
    UploadModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
