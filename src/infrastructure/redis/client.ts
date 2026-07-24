import { Redis } from 'ioredis';
import { getEnv } from '../config/env.js';

let redisInstance: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisInstance) {
    const env = getEnv();
    redisInstance = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      lazyConnect: true,
      connectTimeout: 4_000,
    });
    
    // Attempt connection immediately, but don't block
    if (env.NODE_ENV !== 'test') {
      redisInstance.connect().catch(() => {
        console.warn('Redis no disponible');
      });
    }
  }
  return redisInstance;
}
