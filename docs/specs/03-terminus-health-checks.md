# SPEC: Health Checks Avançados com @nestjs/terminus — payments-service

**Serviço:** payments-service  
**Status:** Proposta  
**Autor:** Arquitetura  
**Data:** 2026-03-10  

---

## 1. Visão Geral

Implementar health checks reais no `payments-service` usando `@nestjs/terminus`, que verificam a conectividade com o **PostgreSQL** (via `TypeOrmHealthIndicator`) e com o **RabbitMQ** (via health indicator customizado).

O `payments-service` é o serviço mais crítico do marketplace — processa pagamentos consumindo mensagens do RabbitMQ e persiste resultados no PostgreSQL. Atualmente não possui um endpoint `GET /health` dedicado na raiz (o health de eventos está em `GET /events/metrics/health`). Precisamos de um endpoint padronizado `GET /health` que o `api-gateway` e o Prometheus possam consultar.

O `payments-service` depende de duas infraestruturas:
1. **PostgreSQL**: armazena as entidades Payment (status, valor, referência)
2. **RabbitMQ**: consome mensagens de `payment_queue` e publica resultados em `payment.result`

---

## 2. Escopo

### Incluso

- Instalação de `@nestjs/terminus` no `payments-service`
- Criação de `HealthModule` com `HealthController` usando `TerminusModule`
- Verificação do PostgreSQL via `TypeOrmHealthIndicator`
- Verificação do RabbitMQ via health indicator customizado
- Endpoint `GET /health` público (sem autenticação)
- Resposta HTTP 200 quando saudável, HTTP 503 quando não saudável

### Fora de escopo

- Readiness/liveness probes (conceito de Kubernetes)
- Alteração do endpoint existente `GET /events/metrics/health` (mantido como está)
- Alterações em métricas ou dashboards existentes
- Notificações externas (Slack, email)

---

## 3. Contexto do Serviço

| Aspecto | Detalhe |
|---------|---------|
| **Porta** | 3004 |
| **Guard global** | Nenhum (`payments-service` não tem JWT guard global) |
| **Banco de dados** | PostgreSQL via TypeORM (`@nestjs/typeorm`) |
| **RabbitMQ** | `amqplib` via `RabbitmqService` (exchange `payments`, consome `payment_queue`, publica `payment.result`) |
| **Health check atual** | Sem `GET /health` dedicado; existe `GET /events/metrics/health` no `PaymentEventsMetricsController` |
| **DLQ** | `payment_queue.dlq` para mensagens que falharam após retries |

### Conexão RabbitMQ existente

O `RabbitmqService` (`src/events/rabbitmq/rabbitmq.service.ts`) é idêntico ao do `checkout-service`, expondo:
- `getConnection(): amqp.ChannelModel`
- `getChannel(): amqp.Channel`

---

## 4. Dependências

Instalar no `payments-service/`:

```bash
npm install @nestjs/terminus
```

> `@nestjs/typeorm` e `amqplib` já estão instalados.

---

## 5. Estrutura de Arquivos

```
payments-service/
└── src/
    └── health/
        ├── health.module.ts                  ← novo
        ├── health.controller.ts              ← novo
        └── rabbitmq.health-indicator.ts      ← novo
```

---

## 6. Implementação

### 6.1 RabbitMQ Health Indicator (`src/health/rabbitmq.health-indicator.ts`)

Mesma abordagem do `checkout-service` — health indicator customizado que verifica a conexão existente.

```typescript
import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RabbitmqService } from '../events/rabbitmq/rabbitmq.service';

@Injectable()
export class RabbitMQHealthIndicator extends HealthIndicator {
  constructor(private readonly rabbitmqService: RabbitmqService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const connection = this.rabbitmqService.getConnection();
    const channel = this.rabbitmqService.getChannel();

    const isHealthy = !!connection && !!channel;

    const result = this.getStatus(key, isHealthy);

    if (isHealthy) {
      return result;
    }

    throw new HealthCheckError('RabbitMQ check failed', result);
  }
}
```

### 6.2 HealthController (`src/health/health.controller.ts`)

Novo controller para o endpoint padronizado `GET /health`.

```typescript
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { RabbitMQHealthIndicator } from './rabbitmq.health-indicator';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private db: TypeOrmHealthIndicator,
    private rabbitmq: RabbitMQHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => this.rabbitmq.isHealthy('rabbitmq'),
    ]);
  }
}
```

> **Nota:** o `payments-service` não tem `JwtAuthGuard` global, então não precisa de `@Public()`.

**Formato de resposta quando tudo saudável (HTTP 200):**

```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "rabbitmq": { "status": "up" }
  },
  "error": {},
  "details": {
    "database": { "status": "up" },
    "rabbitmq": { "status": "up" }
  }
}
```

### 6.3 HealthModule (`src/health/health.module.ts`)

```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RabbitMQHealthIndicator } from './rabbitmq.health-indicator';
import { RabbitmqService } from '../events/rabbitmq/rabbitmq.service';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RabbitMQHealthIndicator, RabbitmqService],
})
export class HealthModule {}
```

> **Nota:** Se `RabbitmqService` já estiver exportado por um módulo global ou pelo módulo de eventos, pode-se importar esse módulo em vez de re-declarar o provider. Verificar a estrutura de módulos na implementação.

### 6.4 Atualizar AppModule (`src/app.module.ts`)

Adicionar `HealthModule` aos imports do `AppModule`:

```typescript
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    /* ... imports existentes ... */
    HealthModule,
  ],
  /* ... */
})
export class AppModule {}
```

---

## 7. Decisões de Design

- **Mesma abordagem do `checkout-service`**: ambos os serviços usam `amqplib` diretamente, então o health indicator customizado é reutilizado (mesmo padrão, código idêntico).
- **Sem `@Public()`**: o `payments-service` não tem `JwtAuthGuard` global, então o endpoint é acessível por padrão.
- **Endpoint separado de `/events/metrics/health`**: o endpoint existente em `GET /events/metrics/health` contém métricas detalhadas do consumer (contadores de mensagens, taxa de falha). O novo `GET /health` é um health check padronizado focado em dependências de infraestrutura. Ambos coexistem.
- **Verificação leve do RabbitMQ**: apenas verifica se conexão e canal existem, sem publicar mensagens de teste.

---

## 8. Critérios de Aceite

### CA-01: Dependência instalada

- `@nestjs/terminus` deve estar listado em `payments-service/package.json` nas `dependencies`.

### CA-02: Endpoint /health criado com formato terminus

- `GET http://localhost:3004/health` deve retornar HTTP 200 com body contendo `database` e `rabbitmq` em `info`/`details`.

### CA-03: Verificação real do PostgreSQL

- Parar o PostgreSQL e chamar `GET /health` deve retornar HTTP 503 com `error.database.status: "down"`.

### CA-04: Verificação real do RabbitMQ

- Parar o RabbitMQ e reiniciar o `payments-service` — `GET /health` deve retornar HTTP 503 com `error.rabbitmq.status: "down"`.

### CA-05: Falha parcial reportada corretamente

- Se PostgreSQL está UP e RabbitMQ está DOWN, o response deve ter `status: "error"`, com `database: "up"` e `rabbitmq: "down"`.

### CA-06: Endpoint existente não afetado

- O endpoint `GET /events/metrics/health` deve continuar funcionando sem alterações.

### CA-07: Compatibilidade com api-gateway

- O `api-gateway` atualmente chama `GET {payments-url}/health`. O novo endpoint retorna `status: "ok"` quando saudável, mantendo compatibilidade.

---

## 9. Validação

```bash
# 1. Iniciar dependências (PostgreSQL + RabbitMQ)
cd messaging-service && docker-compose up -d

# 2. Iniciar o payments-service
cd payments-service && npm run start:dev

# 3. Verificar health check com tudo disponível
curl -s http://localhost:3004/health | jq .
# Esperado: { "status": "ok", "info": { "database": { "status": "up" }, "rabbitmq": { "status": "up" } }, ... }

# 4. Verificar endpoint antigo ainda funciona
curl -s http://localhost:3004/events/metrics/health | jq .

# 5. Parar o RabbitMQ e reiniciar payments-service
docker stop <rabbitmq-container>
# (reiniciar payments-service)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3004/health
# Esperado: 503

# 6. Verificar detalhes da falha parcial
curl -s http://localhost:3004/health | jq .
# Esperado: database up, rabbitmq down
```

---

## 10. Arquivos Impactados

| Arquivo | Ação |
|---------|------|
| `payments-service/package.json` | Alterar — adicionar `@nestjs/terminus` |
| `payments-service/src/health/health.controller.ts` | Criar |
| `payments-service/src/health/health.module.ts` | Criar |
| `payments-service/src/health/rabbitmq.health-indicator.ts` | Criar |
| `payments-service/src/app.module.ts` | Alterar — importar `HealthModule` |
