import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  configureApp(app);
  setupSwagger(app);

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
