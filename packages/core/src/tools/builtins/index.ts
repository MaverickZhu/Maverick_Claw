// Built-in tools export
export { datetimeTool } from './datetime.js';
export { calculatorTool } from './calculator.js';
export { readFileTool, listDirectoryTool } from './fs.js';
export { systemInfoTool, runCommandTool } from './system.js';
export { fetchUrlTool, searchTool } from './web.js';
export { analyzeCodeTool, formatJsonTool } from './code.js';

import { datetimeTool } from './datetime.js';
import { calculatorTool } from './calculator.js';
import { readFileTool, listDirectoryTool } from './fs.js';
import { systemInfoTool, runCommandTool } from './system.js';
import { fetchUrlTool, searchTool } from './web.js';
import { analyzeCodeTool, formatJsonTool } from './code.js';
import type { Tool } from '../types.js';

// All built-in tools
export const builtinTools: Tool[] = [
  // Time & Math
  datetimeTool,
  calculatorTool,
  
  // File System
  readFileTool,
  listDirectoryTool,
  
  // System
  systemInfoTool,
  runCommandTool,
  
  // Web
  fetchUrlTool,
  searchTool,
  
  // Code
  analyzeCodeTool,
  formatJsonTool,
];

// Tool categories for UI organization
export const toolCategories = {
  '基础工具': [datetimeTool, calculatorTool],
  '文件系统': [readFileTool, listDirectoryTool],
  '系统信息': [systemInfoTool, runCommandTool],
  '网络': [fetchUrlTool, searchTool],
  '代码': [analyzeCodeTool, formatJsonTool],
};
