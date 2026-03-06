import { Controller, Get, Res } from '@nestjs/common';
import * as express from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class PrometheusMetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: express.Response): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    res.set('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }
}
