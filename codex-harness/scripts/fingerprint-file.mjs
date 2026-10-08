#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const file = process.argv[2];
if (!file) {
  process.stderr.write('사용법: node scripts/fingerprint-file.mjs <계획 파일>\n');
  process.exitCode = 2;
} else {
  const digest = createHash('sha256').update(await readFile(file)).digest('hex');
  process.stdout.write(`${digest}  ${file}\n`);
}
