import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  it('compiles the application', async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    expect(module.get(AppModule)).toBeInstanceOf(AppModule);
    await module.close();
  });
});
