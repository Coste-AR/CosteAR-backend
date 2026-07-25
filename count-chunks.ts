import { VaultIndexerService } from './src/application/vault-indexer/vault-indexer-service.js';
import { readFile } from 'fs/promises';
import { chunkMarkdown } from './src/application/vault-indexer/markdown-chunker.js';
import * as path from 'path';
import { readdir } from 'fs/promises';

const IGNORED_DIRS = new Set(['.obsidian', '.trash', '.git']);
async function listMarkdownFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        if (dir === rootDir && entry.name.toLowerCase() === 'readme.md') continue;
        result.push(path.join(dir, entry.name));
      }
    }
  }
  await walk(rootDir);
  return result;
}

async function main() {
  const vaultPath = path.resolve('../CosteAR-vault');
  const files = await listMarkdownFiles(vaultPath);
  let totalChunks = 0;
  for (const f of files) {
    const rawContent = await readFile(f, 'utf-8');
    const sourceFile = path.relative(vaultPath, f).replace(/\\/g, '/');
    const chunks = chunkMarkdown(sourceFile, rawContent);
    totalChunks += chunks.length;
  }
  console.log('Total files:', files.length);
  console.log('Total chunks:', totalChunks);
}
main().catch(console.error);
