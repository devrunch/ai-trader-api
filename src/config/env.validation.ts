import * as Joi from 'joi';

/**
 * Startup-time environment validation.
 *
 * The three keys below are load-bearing secrets. A missing `JWT_SECRET` used to
 * boot a fully functional app signing tokens with a guessable fallback — a
 * silent, total auth bypass triggered by one missing env var. Refusing to start
 * is the safe failure, and it is enforced here rather than at first use.
 *
 * Outside production these stay optional so a fresh clone can run without a
 * fully populated `.env`.
 */
const requiredInProduction = <T extends Joi.AnySchema>(schema: T) =>
  schema.when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().default(8000),

  MONGODB_URI: requiredInProduction(Joi.string().pattern(/^mongodb(\+srv)?:\/\//)),

  // Length is enforced always (not only in production) because a short secret
  // is a real weakness wherever it is used; presence is only required in prod.
  JWT_SECRET: requiredInProduction(Joi.string().min(32)),
  JWT_EXPIRES_IN: Joi.string().default('15m'),

  INTERNAL_API_KEY: requiredInProduction(Joi.string().min(32)),

  FRONTEND_URL: Joi.string().uri().optional(),
  SIGNALS_SERVICE_URL: Joi.string().uri().optional(),

  // Tokens one user may spend on the chat agent per day (IST). The throttler
  // bounds requests per minute, which is not the same as what a day of them
  // costs. See chat/chat-budget.service.ts for the default.
  CHAT_DAILY_TOKEN_CAP: Joi.number().integer().positive().optional(),

  // Only the Fargate/compose deployment runs the in-process SQS poller; in the
  // serverless deployment the dedicated sqsConsumer Lambda owns the queue.
  SIGNALS_POLLER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  SQS_SIGNALS_QUEUE_URL: Joi.string().uri().optional(),

  AWS_REGION: Joi.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),

  GOOGLE_CLIENT_ID: Joi.string().allow('').optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').optional(),
  GOOGLE_CALLBACK_URL: Joi.string().allow('').optional(),
}).unknown(true);
