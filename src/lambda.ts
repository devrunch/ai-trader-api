import { NestFactory } from '@nestjs/core';
import serverlessHttp from 'serverless-http';
import { AppModule } from './app.module';
import { SignalsService } from './signals/signals.service';
import { configureApp, setupSwagger } from './bootstrap';
import { SignalMessage } from './signals/signal.mapper';

// Reuse the NestJS app across warm Lambda invocations
let handler: ReturnType<typeof serverlessHttp>;
let nestApp: Awaited<ReturnType<typeof NestFactory.create>>;

async function bootstrap() {
  nestApp = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });

  configureApp(nestApp);
  setupSwagger(nestApp);

  await nestApp.init();

  return serverlessHttp(nestApp.getHttpAdapter().getInstance(), {
    binary: ['image/*', 'application/octet-stream'],
  });
}

async function getApp() {
  if (!handler) handler = await bootstrap();
  return { handler, nestApp };
}

// HTTP handler — API Gateway → NestJS
export const lambdaHandler = async (event: unknown, context: { callbackWaitsForEmptyEventLoop: boolean }) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const { handler } = await getApp();
  return handler(event as never, context as never);
};

interface SqsEvent {
  Records?: { body: string; messageId: string }[];
}

// SQS handler — consumes signal messages, saves to MongoDB via SignalsService
export const sqsHandler = async (
  event: SqsEvent,
  context: { callbackWaitsForEmptyEventLoop: boolean },
) => {
  context.callbackWaitsForEmptyEventLoop = false;
  const { nestApp } = await getApp();
  const signalsService = nestApp.get(SignalsService);

  const failures: { itemIdentifier: string }[] = [];

  for (const record of event.Records ?? []) {
    try {
      const body = JSON.parse(record.body) as SignalMessage;
      await signalsService.saveFromQueue(body);
    } catch (err) {
      console.error('SQS record failed:', record.messageId, err);
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  // ReportBatchItemFailures — only failed messages return to queue
  return { batchItemFailures: failures };
};
