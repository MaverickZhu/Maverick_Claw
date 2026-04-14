import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (process.env.NODE_ENV === 'production' || !existsSync('.git')) {
  process.exit(0);
}

const result = spawnSync('npx', ['husky'], {
  stdio: 'inherit',
  shell: true,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
