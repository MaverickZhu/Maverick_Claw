#!/usr/bin/env node
/**
 * Build script for Maverick_Claw
 */

import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const packages = ['shared', 'core', 'cli', 'web-ui'];

async function build() {
  console.log('🔨 Building Maverick_Claw...\n');

  // Build order matters due to dependencies
  for (const pkg of packages) {
    console.log(`📦 Building @maverick-claw/${pkg}...`);
    try {
      execSync(`pnpm --filter @maverick-claw/${pkg} build`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      });
      console.log(`✅ @maverick-claw/${pkg} built successfully\n`);
    } catch (error) {
      console.error(`❌ Failed to build @maverick-claw/${pkg}`);
      process.exit(1);
    }
  }

  console.log('✨ All packages built successfully!');
}

build().catch(console.error);
