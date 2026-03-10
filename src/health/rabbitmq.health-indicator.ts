import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { RabbitmqService } from '../events/rabbitmq/rabbitmq.service';

@Injectable()
export class RabbitMQHealthIndicator {
  constructor(
    private readonly rabbitmqService: RabbitmqService,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const connection = this.rabbitmqService.getConnection();
    const channel = this.rabbitmqService.getChannel();

    const indicator = this.healthIndicatorService.check(key);

    if (connection && channel) {
      return indicator.up();
    }

    return indicator.down({ message: 'RabbitMQ check failed' });
  }
}
