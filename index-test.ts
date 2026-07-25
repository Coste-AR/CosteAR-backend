import { VaultIndexerService } from './src/application/vault-indexer/vault-indexer-service.js';
import * as path from 'path';

async function main() {
  const indexer = new VaultIndexerService();
  const vaultPath = path.resolve('../CosteAR-vault');
  console.log('Indexing from', vaultPath);
  const res = await indexer.indexVault(vaultPath, 'manual');
  console.log('Result:', res);
}
main().catch(console.error);
