import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const { url } = req;

    if (url === '/metrics') {
      return next.handle();
    }

    const startTime = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => {
          this.recordMetrics(req, context, startTime);
        },
        error: () => {
          this.recordMetrics(req, context, startTime);
        },
      }),
    );
  }

  private recordMetrics(
    req: Request,
    context: ExecutionContext,
    startTime: bigint,
  ): void {
    const res = context.switchToHttp().getResponse<Response>();
    const route = (req.route as { path?: string })?.path || req.url;
    const method = req.method;
    const statusCode = res.statusCode?.toString() || '500';
    const duration =
      Number(process.hrtime.bigint() - startTime) / 1_000_000_000;

    const labels = { method, route, status_code: statusCode };
    this.metricsService.httpRequestsTotal.inc(labels);
    this.metricsService.httpRequestDuration.observe(labels, duration);
  }
}
