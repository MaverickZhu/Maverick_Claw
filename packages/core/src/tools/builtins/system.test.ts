import { describe, it, expect } from 'vitest';
import { systemInfoTool, runCommandTool } from './system.js';

describe('systemInfoTool', () => {
  it('should return system information', async () => {
    const result = await systemInfoTool.execute({});
    expect(result).toHaveProperty('platform');
    expect(result).toHaveProperty('arch');
    expect(result).toHaveProperty('hostname');
    expect(result).toHaveProperty('memory');
    expect(result).toHaveProperty('uptime');
  });
});

describe('runCommandTool', () => {
  it('should execute allowed command with string mode', async () => {
    const result = await runCommandTool.execute({ command: 'node --version' });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('stdout');
    expect(String((result as Record<string, unknown>).stdout)).toMatch(/^v\d/);
  });

  it('should execute allowed command with args array', async () => {
    const result = await runCommandTool.execute({
      command: 'node',
      args: ['-e', "console.log('hello world')"],
    });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('stdout', 'hello world');
  });

  it('should reject disallowed command', async () => {
    const result = await runCommandTool.execute({ command: 'rm -rf /' });
    expect(result).toHaveProperty('success', false);
    expect(result).toHaveProperty('error');
    expect(String((result as Record<string, unknown>).error)).toContain('not in the whitelist');
  });

  it('should reject shell metacharacters in string mode', async () => {
    const result = await runCommandTool.execute({ command: 'node -e "console.log(1 | 2)"' });
    expect(result).toHaveProperty('success', false);
    expect(String((result as Record<string, unknown>).error)).toContain('shell metacharacters');
  });

  it('should allow args array with safe commands', async () => {
    const result = await runCommandTool.execute({
      command: 'node',
      args: ['--version'],
    });
    expect(result).toHaveProperty('success', true);
  });

  it('should respect timeout', async () => {
    const result = await runCommandTool.execute({
      command: 'node',
      args: ['-e', 'setTimeout(()=>{}, 5000)'],
      timeout: 0.1,
    });
    expect(result).toHaveProperty('success', false);
    expect(String((result as Record<string, unknown>).error)).toMatch(/timed out|timeout/i);
  });

  it('should respect maxOutputLines', async () => {
    const result = await runCommandTool.execute({
      command: 'node',
      args: ['-e', 'for(let i=1;i<=100;i++)console.log(i)'],
      maxOutputLines: 5,
    });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('truncated', true);
    expect(String((result as Record<string, unknown>).stdout)).toContain('more lines truncated');
  });

  it('should reject invalid cwd', async () => {
    const result = await runCommandTool.execute({
      command: 'node',
      args: ['--version'],
      cwd: '/etc/secret',
    });
    expect(result).toHaveProperty('success', false);
    expect(String((result as Record<string, unknown>).error)).toContain('not allowed');
  });

  it('should block dangerous patterns', async () => {
    const result = await runCommandTool.execute({
      command: 'bash -c "echo hello"',
    });
    expect(result).toHaveProperty('success', false);
  });
});
