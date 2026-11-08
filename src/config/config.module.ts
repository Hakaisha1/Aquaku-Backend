import { Global, Module } from '@nestjs/common';
import { RUNTIME_CONFIG, validateConfig } from './runtime-config';

@Global()
@Module({
  providers: [
    { provide: RUNTIME_CONFIG, useFactory: () => validateConfig(process.env) },
  ],
  exports: [RUNTIME_CONFIG],
})
export class ConfigModule {}
