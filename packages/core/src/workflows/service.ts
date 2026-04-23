import { v4 as uuidv4 } from 'uuid';
import type { Workflow } from '@maverick-claw/shared';
import type { DatabaseManager } from '../storage/db.js';
import { logger } from '../utils/logger.js';
import { listWorkflowTemplates } from '../tools/workflows.js';
import { getToolOrchestrator, type ExecutionPlan, type ExecutionResult } from '../tools/orchestrator.js';

export interface CreateWorkflowParams {
  name: string;
  description?: string;
  definition: ExecutionPlan;
  ownerId?: string;
}

export class WorkflowService {
  constructor(private dbManager: DatabaseManager) {}

  private get db() {
    return this.dbManager.getDb();
  }

  async createWorkflow(params: CreateWorkflowParams): Promise<Workflow> {
    const id = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    this.db.prepare(
      `INSERT INTO workflows (id, name, description, definition, owner_id, is_builtin, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id,
      params.name,
      params.description || null,
      JSON.stringify(params.definition),
      params.ownerId || null,
      now,
      now
    );

    logger.info({ workflowId: id, name: params.name }, 'Created workflow');

    return {
      id,
      name: params.name,
      description: params.description,
      definition: params.definition as unknown as Record<string, unknown>,
      ownerId: params.ownerId,
      isBuiltin: false,
      createdAt: new Date(now * 1000),
      updatedAt: new Date(now * 1000),
    };
  }

  async getWorkflow(id: string): Promise<Workflow | null> {
    const row = this.db.prepare('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | undefined;
    return row ? this.rowToWorkflow(row) : null;
  }

  async listWorkflows(filter: { ownerId?: string; includeBuiltin?: boolean } = {}): Promise<Workflow[]> {
    const workflows: Workflow[] = [];

    // Add builtin templates
    if (filter.includeBuiltin !== false) {
      const templates = listWorkflowTemplates();
      for (const t of templates) {
        workflows.push({
          id: `builtin:${t.name}`,
          name: t.name,
          description: t.description,
          definition: {},
          isBuiltin: true,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        });
      }
    }

    // Query DB workflows
    let sql = 'SELECT * FROM workflows WHERE 1=1';
    const params: unknown[] = [];

    if (filter.ownerId) {
      sql += ' AND owner_id = ?';
      params.push(filter.ownerId);
    }

    sql += ' ORDER BY updated_at DESC';

    const rows = this.db.prepare(sql).all(...params) as WorkflowRow[];
    workflows.push(...rows.map((row) => this.rowToWorkflow(row)));

    return workflows;
  }

  async updateWorkflow(id: string, params: Partial<CreateWorkflowParams>): Promise<void> {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (params.name !== undefined) {
      sets.push('name = ?');
      values.push(params.name);
    }
    if (params.description !== undefined) {
      sets.push('description = ?');
      values.push(params.description || null);
    }
    if (params.definition !== undefined) {
      sets.push('definition = ?');
      values.push(JSON.stringify(params.definition));
    }

    if (sets.length === 0) return;

    sets.push('updated_at = ?');
    values.push(Math.floor(Date.now() / 1000));
    values.push(id);

    this.db.prepare(`UPDATE workflows SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    logger.info({ workflowId: id }, 'Updated workflow');
  }

  async deleteWorkflow(id: string): Promise<void> {
    this.db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    logger.info({ workflowId: id }, 'Deleted workflow');
  }

  async executeWorkflow(
    workflowId: string,
    params: Record<string, unknown>,
    context: { sessionId: string; requestId: string }
  ): Promise<ExecutionResult> {
    // Check if it's a builtin template
    if (workflowId.startsWith('builtin:')) {
      const templateName = workflowId.slice('builtin:'.length);
      const { getWorkflowTemplate } = await import('../tools/workflows.js');
      const template = getWorkflowTemplate(templateName);
      if (!template) {
        throw new Error(`Workflow template not found: ${templateName}`);
      }
      const plan = template.createPlan(params);
      const orchestrator = getToolOrchestrator();
      return orchestrator.executePlan(plan, context);
    }

    // DB workflow
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    const plan = workflow.definition as unknown as ExecutionPlan;
    const orchestrator = getToolOrchestrator();
    return orchestrator.executePlan(plan, context);
  }

  private rowToWorkflow(row: WorkflowRow): Workflow {
    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      definition: JSON.parse(row.definition),
      ownerId: row.owner_id || undefined,
      isBuiltin: row.is_builtin === 1,
      createdAt: new Date(row.created_at * 1000),
      updatedAt: new Date(row.updated_at * 1000),
    };
  }
}

interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  definition: string;
  owner_id: string | null;
  is_builtin: number;
  created_at: number;
  updated_at: number;
}
