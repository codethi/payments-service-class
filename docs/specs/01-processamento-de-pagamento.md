# SPEC: Processamento de Pagamento

**Serviço:** payments-service (porta 3004)  
**Status:** Proposta  
**Autor:** Arquitetura  
**Data:** 2026-03-05  

---

## 1. Visão Geral

Implementar o fluxo completo de processamento de pagamento no `payments-service`. Atualmente, o `PaymentConsumerService` consome mensagens da fila `payment_queue` do RabbitMQ, valida a estrutura da mensagem (`PaymentOrderMessage`), mas não executa nenhum processamento real — apenas loga a mensagem recebida (TODO).

Esta spec define a criação da entidade de persistência, o gateway simulado, o serviço de processamento, a integração com o consumer existente e o endpoint de consulta.

---

## 2. Escopo

### Incluso

- Entidade `Payment` com persistência no PostgreSQL via TypeORM
- Serviço `FakePaymentGatewayService` com simulação determinística
- Serviço `PaymentsService` com lógica de processamento e consulta
- Integração do processamento real no `PaymentConsumerService` existente (substituição do TODO)
- Controller `PaymentsController` com endpoint de consulta por `orderId`
- Endpoint de health check dedicado
- Notificação assíncrona do resultado do pagamento via RabbitMQ para o `checkout-service`
- Consumer no `checkout-service` que recebe o resultado e atualiza o status do pedido (`Order`)

### Fora de escopo

- Integração com gateways reais (Stripe, PagSeguro, etc.)
- Alterações nos endpoints existentes de DLQ (`/dlq/*`) e métricas (`/metrics/*`)
- Autenticação/autorização nos endpoints (será tratada em spec futura)

---

## 3. Entidade Payment

Criar a entidade `Payment` mapeada para a tabela `payments` no PostgreSQL.

| Campo             | Tipo                        | Restrições                                      |
|-------------------|-----------------------------|--------------------------------------------------|
| `id`              | UUID                        | PK, gerado automaticamente                       |
| `orderId`         | UUID                        | Obrigatório, indexado                             |
| `userId`          | UUID                        | Obrigatório                                       |
| `amount`          | decimal(10,2)               | Obrigatório                                       |
| `status`          | enum: `pending`, `approved`, `rejected` | Obrigatório, default `pending`       |
| `paymentMethod`   | varchar(50)                 | Obrigatório                                       |
| `transactionId`   | varchar(255)                | Nullable, preenchido após processamento no gateway |
| `rejectionReason` | varchar(255)                | Nullable, preenchido quando rejeitado             |
| `processedAt`     | timestamp                   | Nullable, preenchido após processamento no gateway |
| `createdAt`       | timestamp                   | Gerado automaticamente pelo TypeORM               |
| `updatedAt`       | timestamp                   | Atualizado automaticamente pelo TypeORM            |

**Índices:** índice único em `orderId` (um pagamento por pedido).

---

## 4. FakePaymentGatewayService

Serviço injetável que simula a comunicação com um gateway de pagamento externo.

### Comportamento

1. Receber os dados de pagamento (amount, paymentMethod)
2. Simular latência de rede entre 500ms e 2000ms (aleatória)
3. Aplicar regras de aprovação/rejeição determinísticas baseadas no valor
4. Retornar o resultado do processamento

### Regras de simulação (avaliadas em ordem)

| Condição                                     | Resultado  | Motivo da rejeição                     |
|----------------------------------------------|------------|----------------------------------------|
| `amount` > 10000                             | Rejeitado  | `"Limite excedido"`                    |
| `amount` com parte decimal terminando em `.99` | Rejeitado  | `"Cartão recusado pela operadora"`     |
| Qualquer outro valor                         | Aprovado   | —                                      |

### Retorno

O serviço deve retornar um objeto contendo:
- `approved` (boolean): se o pagamento foi aprovado
- `transactionId` (string): identificador único da transação gerado pelo gateway (UUID)
- `rejectionReason` (string, opcional): motivo da rejeição, presente apenas quando `approved` é `false`

---

## 5. PaymentsService

Serviço principal que orquestra o processamento de pagamentos e disponibiliza consultas.

### Método: processPayment

**Entrada:** dados da mensagem `PaymentOrderMessage`

**Fluxo:**

1. Criar um registro `Payment` com status `pending` e persistir no banco
2. Chamar o `FakePaymentGatewayService` com os dados de pagamento
3. Atualizar o registro `Payment` com base no resultado do gateway:
   - Se aprovado: status → `approved`, preencher `transactionId` e `processedAt`
   - Se rejeitado: status → `rejected`, preencher `transactionId`, `rejectionReason` e `processedAt`
4. Salvar o registro atualizado no banco
5. Logar o resultado do processamento (orderId, status, transactionId)

**Tratamento de erro:** se ocorrer um erro inesperado durante o processamento (ex: falha no banco), o erro deve propagar para que o consumer do RabbitMQ faça NACK e acione o mecanismo de retry/DLQ existente.

### Método: findByOrderId

**Entrada:** `orderId` (string UUID)

**Fluxo:**

1. Buscar registro `Payment` pelo campo `orderId`
2. Se encontrado, retornar o registro completo
3. Se não encontrado, lançar exceção que resulte em HTTP 404

---

## 6. Integração com PaymentConsumerService

O `PaymentConsumerService` já possui toda a lógica de:
- Consumo da fila `payment_queue`
- Validação da mensagem (`validateMessage`)
- Retry e métricas

### Alteração necessária

Substituir o bloco TODO no método `processPaymentOrder` por uma chamada ao `PaymentsService.processPayment()`, passando a mensagem validada.

O fluxo de sucesso/erro e a atualização de métricas devem continuar funcionando como já estão — o `processPayment` deve lançar exceção em caso de falha para que o consumer trate via NACK.

### Injeção de dependência

O `PaymentsService` deve ser injetado no `PaymentConsumerService` via construtor.

---

## 7. Notificação Assíncrona — Payment Result

Após processar o pagamento (aprovado ou rejeitado), o `payments-service` deve publicar o resultado em uma fila RabbitMQ para que o `checkout-service` atualize o status do pedido (`Order`) no seu próprio banco de dados.

### 7.1 PaymentResultMessage (Interface)

Definir a interface da mensagem de resultado em ambos os serviços:

| Campo             | Tipo                          | Descrição                                      |
|-------------------|-------------------------------|-------------------------------------------------|
| `orderId`         | string (UUID)                 | ID do pedido no checkout-service                |
| `status`          | `'approved'` \| `'rejected'`  | Resultado do processamento                      |
| `transactionId`   | string                        | ID da transação gerado pelo gateway             |
| `rejectionReason` | string \| null                | Motivo da rejeição (null se aprovado)           |
| `processedAt`     | string (ISO 8601)             | Timestamp do processamento                      |

### 7.2 Topologia RabbitMQ

Reutilizar a exchange `payments` (topic) já existente, adicionando uma nova routing key e fila:

| Componente       | Valor                    | Descrição                                         |
|------------------|--------------------------|----------------------------------------------------|
| Exchange         | `payments`               | Reutiliza a exchange topic existente               |
| Routing Key      | `payment.result`         | Nova routing key para resultados de pagamento      |
| Queue            | `payment_result_queue`   | Nova fila consumida pelo checkout-service          |

A fila `payment_result_queue` deve ser durável e vinculada à exchange `payments` com routing key `payment.result`. Deve seguir o mesmo padrão de retry/DLQ das filas existentes.

### 7.3 Publicação no payments-service

**Onde:** `PaymentConsumerService.processPaymentOrder()`, imediatamente após o `processPayment()` retornar com sucesso.

**Fluxo:**

1. O `processPayment` conclui o processamento e salva o `Payment` com status final (`approved` ou `rejected`)
2. Construir a mensagem `PaymentResultMessage` com os dados do pagamento processado
3. Publicar na exchange `payments` com routing key `payment.result` usando o `PaymentResultPublisherService`
4. Logar a publicação com orderId e status

**Tratamento de erro:** se a publicação falhar, o erro deve ser logado mas **não** deve impedir o fluxo principal (o pagamento já foi processado e salvo). A consulta via `GET /payments/:orderId` continua funcionando como fallback.

**Implementação:** criar um `PaymentResultPublisherService` no `EventsModule` que encapsula a lógica de publicação (exchange, routing key, serialização). O `PaymentConsumerService` já tem acesso a este módulo e invoca a publicação após o `processPayment()` retornar com sucesso, eliminando a necessidade de alterar as dependências do `PaymentsModule`.

**Nota:** o consumer que recebe essa mensagem no `checkout-service` está definido na spec `checkout-service/docs/specs/04-implement-order-checkout.md`.

---

## 8. PaymentsController

Novo controller para expor endpoints REST de consulta de pagamentos.

### Endpoints

| Método | Rota                  | Descrição                          | Resposta sucesso | Resposta erro         |
|--------|-----------------------|------------------------------------|------------------|-----------------------|
| GET    | `/payments/:orderId`  | Consultar pagamento por orderId    | 200 + Payment    | 404 se não encontrado |

### Resposta de sucesso (200)

Retornar o objeto `Payment` completo com todos os campos da entidade.

### Resposta de erro (404)

Retornar objeto com mensagem indicando que o pagamento não foi encontrado para o `orderId` informado.

---

## 9. Health Check

### Endpoint

| Método | Rota      | Descrição                         |
|--------|-----------|-----------------------------------|
| GET    | `/health` | Verificação de saúde do serviço   |

### Resposta

Retornar um objeto contendo:
- `status`: `"ok"`
- `service`: `"payments-service"`
- `timestamp`: data/hora atual em ISO 8601

---

## 10. Estrutura de Módulos

#### PaymentsModule (novo)

Módulo dedicado ao domínio de pagamentos, contendo:
- `Payment` (entidade registrada via TypeORM)
- `PaymentsService`
- `PaymentsController`
- `FakePaymentGatewayService`

Este módulo deve exportar o `PaymentsService` para que o `EventsModule` possa utilizá-lo.

#### EventsModule (alteração)

- Importar o `PaymentsModule` para ter acesso ao `PaymentsService` e injetá-lo no `PaymentConsumerService`
- Criar o `PaymentResultPublisherService` para encapsular a publicação de resultados de pagamento

#### AppModule (alteração)

Importar o `PaymentsModule` na raiz para que o controller e as entidades sejam registrados.

---

## 11. Critérios de Aceite

### CA-01: Persistência do pagamento
- Ao receber uma mensagem válida da fila, um registro `Payment` deve ser criado na tabela `payments` com status `pending`, e atualizado para `approved` ou `rejected` após processamento.

### CA-02: Aprovação de pagamento
- Uma mensagem com `amount` = 150.00 deve resultar em um `Payment` com status `approved`, `transactionId` preenchido e `rejectionReason` nulo.

### CA-03: Rejeição por limite excedido
- Uma mensagem com `amount` = 15000.00 deve resultar em um `Payment` com status `rejected`, `rejectionReason` = `"Limite excedido"` e `transactionId` preenchido.

### CA-04: Rejeição por cartão recusado
- Uma mensagem com `amount` = 99.99 deve resultar em um `Payment` com status `rejected`, `rejectionReason` = `"Cartão recusado pela operadora"` e `transactionId` preenchido.

### CA-05: Consulta por orderId
- `GET /payments/:orderId` com um orderId existente deve retornar 200 com os dados completos do pagamento.

### CA-06: Consulta inexistente
- `GET /payments/:orderId` com um orderId que não possui pagamento deve retornar 404.

### CA-07: Integração com consumer
- O consumer do RabbitMQ deve processar mensagens de ponta a ponta: receber da fila → validar → processar pagamento → persistir resultado. O TODO atual não deve mais existir.

### CA-08: Retry preservado
- Caso o `PaymentsService.processPayment()` lance uma exceção (ex: falha de banco), o consumer deve fazer NACK na mensagem, acionando o mecanismo de retry existente. Após esgotar retries, a mensagem deve ir para a DLQ.

### CA-09: Métricas preservadas
- As métricas do consumer (`totalProcessed`, `totalSuccess`, `totalFailed`, etc.) devem continuar sendo atualizadas corretamente após a integração.

### CA-10: Health check
- `GET /health` deve retornar 200 com status `"ok"`, nome do serviço e timestamp.

### CA-11: Endpoints existentes intactos
- Os endpoints de DLQ (`/dlq/*`) e métricas (`/metrics/*`) devem continuar funcionando sem alterações.

### CA-12: Idempotência
- Se uma mensagem com o mesmo `orderId` for processada novamente (ex: reprocessamento da DLQ), o serviço deve lidar com isso adequadamente — não deve criar registros duplicados para o mesmo `orderId`.

### CA-13: Publicação do resultado do pagamento
- Após processar um pagamento (aprovado ou rejeitado), o `payments-service` deve publicar uma mensagem `PaymentResultMessage` na exchange `payments` com routing key `payment.result`.

### CA-14: Resiliência da publicação
- Se a publicação do resultado falhar (ex: RabbitMQ indisponível), o pagamento já processado e salvo no banco do `payments-service` não deve ser afetado. O erro deve ser logado. A consulta via `GET /payments/:orderId` continua funcionando como fallback.

---

## 12. Observações Técnicas

- A entidade `Payment` será auto-sincronizada em ambiente de desenvolvimento pelo TypeORM (`synchronize: true`).
- O padrão de entidades `**/*.entity{.ts,.js}` já está configurado no `database.config.ts`.
- A latência simulada no `FakePaymentGatewayService` é proposital para simular condições reais e testar o comportamento assíncrono.
- O `FakePaymentGatewayService` deve ser um provider injetável para facilitar substituição futura por um gateway real.
- A publicação do resultado é fire-and-forget com log de erro. Em caso de falha, o dado está salvo no banco e pode ser consultado via REST.
- O consumer que recebe a mensagem `PaymentResultMessage` no `checkout-service` está especificado na spec `checkout-service/docs/specs/04-implement-order-checkout.md`.

---

## 13. Dependências entre Componentes

```
checkout-service                                payments-service
│                                               ┌─────────────────────────────────┐
│   (publica na fila payment_queue)             │                                 │
├──────────────────▶ payment_queue ────────────▶│  PaymentConsumerService          │
│                                               │    │ processPaymentOrder()      │
│                                               │    └──▶ PaymentsService         │
│                                               │           │ processPayment()     │
│                                               │           ├──▶ FakePaymentGateway│
│   (consome da fila payment_result_queue)      │           └──▶ Payment Entity/DB │
│◀─────────────────  payment_result_queue ◀────│                                 │
│                                               │  PaymentResultPublisherService   │
│                                               │    └──▶ publica payment.result   │
│                                               │                                 │
│                                               │  PaymentsController              │
│                                               │    └──▶ PaymentsService (REST)   │
│                                               └─────────────────────────────────┘
```

---

## 14. Arquivos Impactados

| Arquivo                                                    | Ação    |
|------------------------------------------------------------|---------|
| `src/payments/payment.entity.ts`                           | Criar   |
| `src/payments/payments.service.ts`                         | Criar   |
| `src/payments/payments.controller.ts`                      | Criar   |
| `src/payments/payments.module.ts`                          | Criar   |
| `src/payments/fake-payment-gateway.service.ts`             | Criar   |
| `src/events/payment-result/payment-result-publisher.service.ts` | Criar   |
| `src/events/payment-result/payment-result.interface.ts`    | Criar   |
| `src/events/payment-consumer/payment-consumer.service.ts`  | Alterar |
| `src/events/events.module.ts`                              | Alterar |
| `src/app.module.ts`                                        | Alterar |
| `src/app.controller.ts`                                    | Alterar |