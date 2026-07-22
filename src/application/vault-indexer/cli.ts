import { execSync } from 'node:child_process';
import { VaultIndexerService } from './vault-indexer-service.js';

function getVaultCommit(vaultPath: string): string {
  return execSync('git rev-parse HEAD', { cwd: vaultPath }).toString().trim();
}

async function main(): Promise<void> {
  const vaultPath = process.argv[2];
  if (!vaultPath) {
    console.error('Uso: npm run vault:index -- <path-al-vault-clonado>');
    process.exit(1);
  }

  const vaultCommit = getVaultCommit(vaultPath);
  console.log(`Indexando bóveda en ${vaultPath} (commit ${vaultCommit.slice(0, 7)})...`);

  const service = new VaultIndexerService();
  const result = await service.indexVault(vaultPath, vaultCommit);

  console.log(`Archivos procesados: ${result.filesProcessed}`);
  console.log(`Chunks nuevos/actualizados: ${result.chunksUpserted}`);
  console.log(`Chunks sin cambios (omitidos): ${result.chunksSkippedUnchanged}`);
  console.log(`Chunks eliminados (huérfanos o de notas achicadas): ${result.chunksDeleted}`);
  if (result.filesWithErrors.length > 0) {
    console.error(`Archivos con errores: ${result.filesWithErrors.join(', ')}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[vault:index] Error fatal:', err);
  process.exit(1);
});
