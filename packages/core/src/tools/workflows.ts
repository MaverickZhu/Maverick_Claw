// Predefined Tool Workflows - Common multi-tool patterns
import type { ExecutionPlan } from './orchestrator.js';
import type { ToolNode } from './orchestrator.js';
import type { ToolResult } from './types.js';

export interface WorkflowTemplate {
  name: string;
  description: string;
  createPlan: (params: Record<string, unknown>) => ExecutionPlan;
}

/**
 * Workflow: Analyze Project
 * 1. List directory structure
 * 2. Read key files (package.json, README, etc.)
 * 3. Analyze code patterns
 */
export const analyzeProjectWorkflow: WorkflowTemplate = {
  name: 'analyze_project',
  description: 'Analyze a project directory structure and key files',
  createPlan: (params: Record<string, unknown>): ExecutionPlan => {
    const projectPath = String(params.path || '.');

    const nodes: ToolNode[] = [
      {
        id: 'list-dir',
        toolCall: {
          id: 'list-dir-call',
          name: 'list_directory',
          arguments: { path: projectPath, recursive: false },
        },
        dependencies: [],
      },
      {
        id: 'read-package',
        toolCall: {
          id: 'read-package-call',
          name: 'read_file',
          arguments: { path: `${projectPath}/package.json` },
        },
        dependencies: [],
      },
      {
        id: 'read-readme',
        toolCall: {
          id: 'read-readme-call',
          name: 'read_file',
          arguments: { path: `${projectPath}/README.md`, limit: 50 },
        },
        dependencies: [],
      },
      {
        id: 'analyze-structure',
        toolCall: {
          id: 'analyze-call',
          name: 'analyze_code',
          arguments: {
            code: '${list-dir.output}',
            language: 'javascript',
          },
        },
        dependencies: ['list-dir'],
      },
    ];

    return {
      nodes,
      parallel: true,
      timeout: 60000,
    };
  },
};

/**
 * Workflow: Web Research
 * 1. Fetch multiple URLs
 * 2. Summarize content
 */
export const webResearchWorkflow: WorkflowTemplate = {
  name: 'web_research',
  description: 'Research multiple web pages in parallel',
  createPlan: (params: Record<string, unknown>): ExecutionPlan => {
    const urlsParam = params.urls;
    const urls = Array.isArray(urlsParam) ? urlsParam : [String(urlsParam || '')];

    const nodes: ToolNode[] = urls.map((url, index) => ({
      id: `fetch-${index}`,
      toolCall: {
        id: `fetch-${index}-call`,
        name: 'fetch_url',
        arguments: { url: String(url), maxLength: 3000 },
      },
      dependencies: [],
    }));

    return {
      nodes,
      parallel: true,
      timeout: 30000,
    };
  },
};

/**
 * Workflow: System Diagnostics
 * 1. Get system info
 * 2. Check disk usage
 * 3. List running processes
 */
export const systemDiagnosticsWorkflow: WorkflowTemplate = {
  name: 'system_diagnostics',
  description: 'Run comprehensive system diagnostics',
  createPlan: (): ExecutionPlan => ({
    nodes: [
      {
        id: 'sys-info',
        toolCall: {
          id: 'sys-info-call',
          name: 'system_info',
          arguments: {},
        },
        dependencies: [],
      },
      {
        id: 'check-disk',
        toolCall: {
          id: 'check-disk-call',
          name: 'run_command',
          arguments: { command: 'df -h' },
        },
        dependencies: [],
      },
      {
        id: 'list-procs',
        toolCall: {
          id: 'list-procs-call',
          name: 'run_command',
          arguments: { command: 'ps aux --sort=-%mem | head -20' },
        },
        dependencies: [],
      },
    ],
    parallel: true,
    timeout: 15000,
  }),
};

/**
 * Workflow: Code Review
 * 1. Read file
 * 2. Analyze code
 * 3. Format any JSON configs
 */
export const codeReviewWorkflow: WorkflowTemplate = {
  name: 'code_review',
  description: 'Review a code file with analysis',
  createPlan: (params: Record<string, unknown>): ExecutionPlan => {
    const filePath = String(params.filePath || '');
    const language = String(params.language || 'javascript');

    return {
      nodes: [
        {
          id: 'read-code',
          toolCall: {
            id: 'read-code-call',
            name: 'read_file',
            arguments: { path: filePath },
          },
          dependencies: [],
        },
        {
          id: 'analyze',
          toolCall: {
            id: 'analyze-call',
            name: 'analyze_code',
            arguments: {
              code: '${read-code.output.content}',
              language,
            },
          },
          dependencies: ['read-code'],
        },
      ],
      parallel: false,
    };
  },
};

/**
 * Workflow: Data Pipeline
 * 1. Fetch data from URL
 * 2. Validate/format JSON
 * 3. Calculate statistics
 */
export const dataPipelineWorkflow: WorkflowTemplate = {
  name: 'data_pipeline',
  description: 'Fetch, validate, and analyze JSON data',
  createPlan: (params: Record<string, unknown>): ExecutionPlan => ({
    nodes: [
      {
        id: 'fetch',
        toolCall: {
          id: 'fetch-call',
          name: 'fetch_url',
          arguments: { url: String(params.url || '') },
        },
        dependencies: [],
      },
      {
        id: 'validate',
        toolCall: {
          id: 'validate-call',
          name: 'format_json',
          arguments: {
            json: '${fetch.output.content}',
          },
        },
        dependencies: ['fetch'],
      },
      {
        id: 'analyze',
        toolCall: {
          id: 'analyze-call',
          name: 'analyze_code',
          arguments: {
            code: '${validate.output.formatted}',
            language: 'json',
          },
        },
        dependencies: ['validate'],
        condition: (results: Map<string, ToolResult>) => {
          const validate = results.get('validate');
          return (validate?.output as { valid?: boolean })?.valid === true;
        },
      },
    ],
    parallel: false,
  }),
};

// Registry of all workflows
export const workflowTemplates: WorkflowTemplate[] = [
  analyzeProjectWorkflow,
  webResearchWorkflow,
  systemDiagnosticsWorkflow,
  codeReviewWorkflow,
  dataPipelineWorkflow,
];

export function getWorkflowTemplate(name: string): WorkflowTemplate | undefined {
  return workflowTemplates.find(w => w.name === name);
}

export function listWorkflowTemplates(): Array<{ name: string; description: string }> {
  return workflowTemplates.map(w => ({
    name: w.name,
    description: w.description,
  }));
}
