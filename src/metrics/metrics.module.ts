import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { PrometheusMetricsController } from './metrics.controller';
import { HttpMetricsMiddleware } from './http-metrics.middleware';

@Global()
@Module({
  controllers: [PrometheusMetricsController],
  providers: [MetricsService, HttpMetricsMiddleware],
  exports: [MetricsService, HttpMetricsMiddleware],
})
export class MetricsModule {}
