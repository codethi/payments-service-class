# SPEC: Instrumentação de Métricas HTTP — payments-service

**Serviço:** payments-service  
**Status:** Proposta  
**Autor:** Arquitetura  
**Data:** 2026-03-05  

---

## 1. Visão Geral

Instrumentar o `payments-service` (porta 3004) com métricas HTTP usando `prom-client`, expondo o endpoint `GET /metrics` no formato Prometheus. Isso permitirá que o Prometheus (já configurado na SPEC 01 do `observability-stack`) colete métricas automaticamente a cada 15s.

O `payments-service` tem uma particularidade: **já possui um `MetricsController`** no path `src/events/metrics/metrics.controller.ts` que expõe `GET /metrics` retornando JSON com métricas de negócio do consumer de pagamentos. Esse controller **não** é compatível com o formato Prometheus e precisa ser migrado para uma rota diferente (`/consumer-metrics`) para liberar `/metrics` para o novo endpoint Prometheus.

Além disso, o `payments-service` **não possui `AuthModule`** nem `JwtAuthGuard` global — portanto, o endpoint `/metrics` não precisa de `@Public()`.

---

## 2. Escopo

### Incluso

- Instalação do `prom-client` como dependência
- Migração do `MetricsController` existente (JSON) de `/metrics` para `/consumer-metrics`
- Criação do `MetricsModule` (`@Global`) com `MetricsService`, `HttpMetricsInterceptor` e `PrometheusMetricsController`
- Registro do módulo no `AppModule`
- Endpoint `GET /metrics` retornando métricas no formato Prometheus

### Fora de escopo

- Métricas de negócio customizadas — spec futura
- Dashboards no Grafana — spec futura
- Alterações no Prometheus ou Grafana — já configurados

---

## 3. Contexto do Serviço

| Aspecto | Detalhe |
|---------|---------|
| **Porta** | 3004 |
| **Guard global** | Nenhum — sem `AuthModule`, sem JWT |
| **@Public()** | N/A — não existe decorator `@Public()` neste serviço |
| **prom-client** | Não instalado |
| **Endpoint /metrics** | **Existe** — retorna JSON com métricas do consumer (não Prometheus) |
| **ConfigModule** | Não importado no `AppModule` (apenas no `EventsModule`) |

### Controller existente em `/metrics`

O arquivo `src/events/metrics/metrics.controller.ts` contém o `MetricsController` com:
- `GET /metrics` — retorna JSON com métricas do consumer (totalProcessed, successRate, etc.)
- `GET /metrics/health` — health check do consumer
- `GET /metrics/summary` — resumo do consumer
- `POST /metrics/reset` — reset das métricas

Este controller retorna JSON e **não** é compatível com o formato Prometheus exposition.

---

## 4. Dependências

Instalar no `payments-service/`:

```bash
npm install prom-client
```

---

## 5. Estrutura de Arquivos

```
payments-service/
└── src/
    ├── events/
    │   └── metrics/
    │       └── metrics.controller.ts     ← ALTERAR: migrar de /metrics para /consumer-metrics
    └── metrics/
        ├── metrics.module.ts             ← módulo @Global (novo)
        ├── metrics.service.ts            ← registry, counter, histogram (novo)
        ├── metrics.controller.ts         ← GET /metrics Prometheus (novo)
        └── http-metrics.interceptor.ts   ← interceptor global (novo)
```

---

## 6. Implementação

### 6.1 Migração do MetricsController existente

**Alterar** o arquivo `src/events/metrics/metrics.controller.ts`:

Mudar o decorator `@Controller('metrics')` para `@Controller('consumer-metrics')`.

```typescript
// ANTES:
@Controller('metrics')
export class MetricsController {

// DEPOIS:
@Controller('consumer-metrics')
export class MetricsController {
```

Isso move todas as rotas do controller existente:
- `GET /metrics` → `GET /consumer-metrics`
- `GET /metrics/health` → `GET /consumer-metrics/health`
- `GET /metrics/summary` → `GET /consumer-metrics/summary`
- `POST /metrics/reset` → `POST /consumer-metrics/reset`

> **Nota:** Nenhuma outra alteração é necessária no controller existente. A funcionalidade e os dados retornados permanecem idênticos.

### 6.2 MetricsService (`src/metrics/metrics.service.ts`)

Responsável por encapsular o `prom-client` Registry e expor as métricas.

**Requisitos:**

- Criar um `Registry` dedicado (não usar o default global, para isolamento)
- Registrar `collectDefaultMetrics` com o registry dedicado e prefix `payments_service_`
- Criar um `Counter` chamado `http_requests_total` com labels: `method`, `route`, `status_code`
- Criar um `Histogram` chamado `http_request_duration_seconds` com labels: `method`, `route`, `status_code`
- Buckets do histogram: `[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]` (padrão Prometheus)
- Expor método `getMetrics(): Promise<string>` que retorna `registry.metrics()`
- Expor método `getContentType(): string` que retorna `registry.contentType`

```typescript
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
```

### 6.3 HttpMetricsInterceptor (`src/metrics/http-metrics.interceptor.ts`)

Interceptor global que captura métricas de cada request HTTP.

**Requisitos:**

- Implementar `NestInterceptor`
- Capturar `method`, `route` e `status_code` de cada request
- Medir a duração da request em segundos
- Incrementar `http_requests_total` e observar `http_request_duration_seconds`
- **Excluir** o endpoint `/metrics` da contabilização (evitar loop de métricas do Prometheus)
- Usar `req.route?.path || req.url` para capturar o route pattern

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const { method, url } = req;

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
    req: any,
    context: ExecutionContext,
    startTime: bigint,
  ): void {
    const res = context.switchToHttp().getResponse();
    const route = req.route?.path || req.url;
    const method = req.method;
    const statusCode = res.statusCode?.toString() || '500';
    const duration =
      Number(process.hrtime.bigint() - startTime) / 1_000_000_000;

    const labels = { method, route, status_code: statusCode };
    this.metricsService.httpRequestsTotal.inc(labels);
    this.metricsService.httpRequestDuration.observe(labels, duration);
  }
}
```

### 6.4 PrometheusMetricsController (`src/metrics/metrics.controller.ts`)

**Requisitos:**

- Rota `GET /metrics` que retorna métricas no formato Prometheus (text/plain)
- **Não** precisa de `@Public()` — o `payments-service` não tem guard global
- Definir `Content-Type` correto via `res.set()`

> **Nota:** O nome da classe é `PrometheusMetricsController` para evitar conflito com o `MetricsController` existente em `src/events/metrics/`. Ambos coexistem no projeto, mas em módulos diferentes.

```typescript
import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class PrometheusMetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response): Promise<void> {
    const metrics = await this.metricsService.getMetrics();
    res.set('Content-Type', this.metricsService.getContentType());
    res.send(metrics);
  }
}
```

### 6.5 MetricsModule (`src/metrics/metrics.module.ts`)

**Requisitos:**

- Decorado com `@Global()` para que `MetricsService` esteja disponível em toda a aplicação
- Registrar `HttpMetricsInterceptor` como `APP_INTERCEPTOR` (interceptor global)
- Exportar `MetricsService`

```typescript
import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsService } from './metrics.service';
import { PrometheusMetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

@Global()
@Module({
  controllers: [PrometheusMetricsController],
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
```

### 6.6 Registro no AppModule (`src/app.module.ts`)

Adicionar `MetricsModule` no array de `imports` do `AppModule`:

```typescript
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseConfig),
    MetricsModule,  // ← adicionar aqui
    EventsModule,
    PaymentsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

---

## 7. Métricas Expostas

| Métrica | Tipo | Labels | Descrição |
|---------|------|--------|-----------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total de requisições HTTP recebidas |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Duração das requisições HTTP em segundos |
| `payments_service_*` (default metrics) | Vários | — | Métricas padrão do Node.js (CPU, memória, event loop, GC, etc.) |

---

## 8. Decisões de Design

- **Migração de `/metrics` para `/consumer-metrics`**: o controller existente retorna JSON com métricas de negócio do consumer RabbitMQ. A rota `/metrics` é reservada pelo Prometheus para scraping. A migração preserva toda a funcionalidade existente em uma nova rota.
- **`PrometheusMetricsController` (nome da classe)**: evita colisão com o `MetricsController` existente em `src/events/metrics/`. Ambos coexistem no projeto em módulos diferentes.
- **Sem `@Public()`**: o `payments-service` não possui `AuthModule` nem `JwtAuthGuard` global. Nenhum bypass de autenticação é necessário.
- **Registry dedicado**: não usa o registry global do `prom-client` para evitar colisão entre módulos ou testes.
- **Prefix `payments_service_`**: as métricas padrão do Node.js recebem prefix para diferenciação quando visualizadas no Prometheus junto com outros serviços.
- **Exclusão de `/metrics` do interceptor**: evita que o próprio scraping do Prometheus infle as métricas HTTP.
- **`process.hrtime.bigint()`**: alta resolução para medir duração com precisão de nanosegundos.
- **`@Global()` no MetricsModule**: permite que qualquer módulo injete `MetricsService` sem importar o módulo explicitamente (preparação para métricas customizadas futuras).

---

## 9. Critérios de Aceite

### CA-01: Dependência instalada

- `prom-client` deve estar listado em `payments-service/package.json` nas `dependencies`.

### CA-02: Endpoint /metrics Prometheus acessível

- `GET http://localhost:3004/metrics` deve retornar HTTP 200 com `Content-Type: text/plain` (ou `application/openmetrics-text`).
- O body deve conter métricas no formato Prometheus exposition format (não JSON).

### CA-03: Controller existente migrado

- `GET http://localhost:3004/consumer-metrics` deve retornar HTTP 200 com JSON contendo as métricas de negócio do consumer (totalProcessed, successRate, etc.).
- `GET http://localhost:3004/consumer-metrics/health` deve funcionar normalmente.
- `GET http://localhost:3004/consumer-metrics/summary` deve funcionar normalmente.
- `POST http://localhost:3004/consumer-metrics/reset` deve funcionar normalmente.

### CA-04: Métricas HTTP registradas

- Após fazer requests a outros endpoints (ex: `GET /consumer-metrics`), executar `GET /metrics` deve retornar:
  - `http_requests_total` com labels `method="GET"`, `route="/consumer-metrics"`, `status_code="200"` com valor ≥ 1
  - `http_request_duration_seconds_bucket` com os mesmos labels

### CA-05: Endpoint /metrics excluído das métricas

- Após múltiplas chamadas a `GET /metrics`, a métrica `http_requests_total` **não** deve conter label `route="/metrics"`.

### CA-06: Métricas padrão do Node.js

- `GET /metrics` deve incluir métricas com prefix `payments_service_` como:
  - `payments_service_process_cpu_user_seconds_total`
  - `payments_service_process_resident_memory_bytes`
  - `payments_service_nodejs_eventloop_lag_seconds`

### CA-07: Target UP no Prometheus

- No Prometheus (`http://localhost:9090/targets`), o target `payments-service` (`host.docker.internal:3004`) deve aparecer como **UP**.

### CA-08: Sem regressão no consumer existente

- O consumer de pagamentos (RabbitMQ) deve continuar funcionando normalmente.
- As métricas de negócio do consumer devem continuar acessíveis em `/consumer-metrics`.

---

## 10. Validação

```bash
# 1. Iniciar o payments-service
cd payments-service && npm run start:dev

# 2. Verificar se /metrics retorna formato Prometheus (não JSON)
curl -s http://localhost:3004/metrics | head -20

# 3. Verificar se o controller antigo foi migrado
curl -s http://localhost:3004/consumer-metrics
# (deve retornar JSON com totalProcessed, successRate, etc.)

# 4. Verificar que /metrics antigo não existe mais
curl -s http://localhost:3004/metrics | python3 -m json.tool 2>&1
# (deve falhar pois o conteúdo é text/plain Prometheus, não JSON)

# 5. Fazer uma request normal
curl -s http://localhost:3004/consumer-metrics/summary

# 6. Verificar se métricas HTTP foram registradas
curl -s http://localhost:3004/metrics | grep http_requests_total

# 7. Verificar que /metrics não aparece nas métricas
curl -s http://localhost:3004/metrics | grep 'route="/metrics"'
# (deve retornar vazio)

# 8. Verificar no Prometheus (stack de observabilidade rodando)
# Acessar http://localhost:9090/targets → payments-service deve estar UP
```

---

## 11. Arquivos Impactados

| Arquivo | Ação |
|---------|------|
| `payments-service/package.json` | Alterar — adicionar `prom-client` |
| `payments-service/src/events/metrics/metrics.controller.ts` | Alterar — migrar de `/metrics` para `/consumer-metrics` |
| `payments-service/src/metrics/metrics.module.ts` | Criar |
| `payments-service/src/metrics/metrics.service.ts` | Criar |
| `payments-service/src/metrics/metrics.controller.ts` | Criar |
| `payments-service/src/metrics/http-metrics.interceptor.ts` | Criar |
| `payments-service/src/app.module.ts` | Alterar — importar `MetricsModule` |
