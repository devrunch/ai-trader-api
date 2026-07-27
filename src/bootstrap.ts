import { INestApplication, ValidationPipe, VERSION_NEUTRAL, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';

/**
 * Everything that must be identical between `main.ts` (Fargate/local) and
 * `lambda.ts` (serverless). They had drifted apart before; a single function
 * makes divergence impossible.
 */
export function configureApp(app: INestApplication): void {
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  // URI versioning, with VERSION_NEUTRAL kept in the default list so BOTH
  // /api/x and /api/v1/x resolve to the same handler. Nest registers one route
  // per entry in `defaultVersion` (see RoutePathFactory.create), and
  // VERSION_NEUTRAL contributes the unversioned path. This gives new clients a
  // version segment without breaking the already-deployed frontend, which
  // calls /api/* directly.
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: [VERSION_NEUTRAL, '1'],
  });
}

/** Machine-readable API description at /api/docs. */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('AI Trader API')
    .setDescription(
      'NestJS API for signals, paper trading, watchlist and the morning brief. ' +
        'Every route is reachable both unversioned (/api/x) and versioned (/api/v1/x).',
    )
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .addApiKey({ type: 'apiKey', name: 'x-internal-key', in: 'header' }, 'internal-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
