import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowService } from './service.js';
import { DatabaseManager } from '../storage/db.js';
import type { ExecutionPlan } from '../tools/orchestrator.js';
import path from 'path';
import os from 'os';
import fs from 'fs';

describe('WorkflowService', () => {
  let dbManager: DatabaseManager;
  let workflowService: WorkflowService;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-workflow-test-'));
    dbPath = path.join(tmpDir, 'test.db');
    dbManager = new DatabaseManager({ dbPath });
    await dbManager.init();
    workflowService = new WorkflowService(dbManager);
  });

  const samplePlan: ExecutionPlan = {
    nodes: [
      {
        id: 'step-1',
        toolCall: { id: 'tc-1', name: 'read_file', arguments: { path: '/tmp/test' } },
        dependencies: [],
      },
    ],
    parallel: false,
  };

  it('should create a workflow', async () => {
    const workflow = await workflowService.createWorkflow({
      name: 'Test Workflow',
      description: 'A test workflow',
      definition: samplePlan,
      ownerId: 'user-1',
    });

    expect(workflow.name).toBe('Test Workflow');
    expect(workflow.ownerId).toBe('user-1');
    expect(workflow.isBuiltin).toBe(false);
  });

  it('should get workflow by id', async () => {
    const created = await workflowService.createWorkflow({ name: 'GetTest', definition: samplePlan });
    const found = await workflowService.getWorkflow(created.id);
    expect(found?.name).toBe('GetTest');
  });

  it('should list workflows including builtins', async () => {
    await workflowService.createWorkflow({ name: 'Custom', definition: samplePlan });
    const workflows = await workflowService.listWorkflows();

    // Should include builtins + custom
    expect(workflows.length).toBeGreaterThan(1);
    const builtin = workflows.find(w => w.isBuiltin);
    expect(builtin).toBeDefined();
    const custom = workflows.find(w => w.name === 'Custom');
    expect(custom).toBeDefined();
  });

  it('should update workflow', async () => {
    const created = await workflowService.createWorkflow({ name: 'Old', definition: samplePlan });
    await workflowService.updateWorkflow(created.id, { name: 'New' });
    const updated = await workflowService.getWorkflow(created.id);
    expect(updated?.name).toBe('New');
  });

  it('should delete workflow', async () => {
    const created = await workflowService.createWorkflow({ name: 'ToDelete', definition: samplePlan });
    await workflowService.deleteWorkflow(created.id);
    const found = await workflowService.getWorkflow(created.id);
    expect(found).toBeNull();
  });

  it('should execute builtin workflow by id', async () => {
    const result = await workflowService.executeWorkflow(
      'builtin:analyze_project',
      { path: '.' },
      { sessionId: 'test-session', requestId: 'test-req' }
    );
    expect(result).toBeDefined();
  });

  it('should throw for nonexistent workflow', async () => {
    await expect(
      workflowService.executeWorkflow('nonexistent', {}, { sessionId: 's', requestId: 'r' })
    ).rejects.toThrow('Workflow not found');
  });
});
