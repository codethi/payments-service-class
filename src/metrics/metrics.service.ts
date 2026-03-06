import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  Counter,
  Histogram,
  collectDefaultMetrics,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly registry: Registry;
  readonly httpRequestsTotal: Counter;
  readonly httpRequestDuration: Histogram;
  readonly paymentsProcessedTotal: Counter;
  readonly paymentsApprovedTotal: Counter;
  readonly paymentsRejectedTotal: Counter;

  constructor() {
    this.registry = new Registry();

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });

    this.paymentsProcessedTotal = new Counter({
      name: 'payments_processed_total',
      help: 'Total number of payments processed',
      registers: [this.registry],
    });

    this.paymentsApprovedTotal = new Counter({
      name: 'payments_approved_total',
      help: 'Total number of approved payments',
      registers: [this.registry],
    });

    this.paymentsRejectedTotal = new Counter({
      name: 'payments_rejected_total',
      help: 'Total number of rejected payments',
      labelNames: ['reason'],
      registers: [this.registry],
    });
  }

  onModuleInit() {
    collectDefaultMetrics({
      register: this.registry,
      prefix: 'payments_service_',
    });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
