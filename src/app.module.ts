import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { EventsModule } from './events/events.module';

@Module({
  imports: [TypeOrmModule.forRoot(databaseConfig), EventsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
