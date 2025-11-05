import * as fs from 'fs';
import * as path from 'path';
import * as Mustache from 'mustache';

const TEMPLATES_DIR = path.join(__dirname, 'templates');

/**
 * Template cache to avoid re-reading files
 */
const templateCache = new Map<string, string>();

/**
 * Load a Mustache template from disk (with caching)
 */
function loadTemplate(templateName: string): string {
  if (templateCache.has(templateName)) {
    return templateCache.get(templateName)!;
  }

  const templatePath = path.join(TEMPLATES_DIR, `${templateName}.mustache`);
  
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template not found: ${templateName}`);
  }

  const content = fs.readFileSync(templatePath, 'utf-8');
  templateCache.set(templateName, content);
  
  return content;
}

/**
 * Render a Mustache template with data
 * Returns rendered HTML string
 */
export function renderTemplate(templateName: string, data: any): string {
  const template = loadTemplate(templateName);
  return Mustache.render(template, data);
}

/**
 * Generate a safe ID for HTML attributes from a string
 * Replaces non-alphanumeric characters with hyphens
 */
export function generateSafeId(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * Convert pipeline status to uppercase text for display
 */
export function formatStatus(status: string): string {
  if (status === 'none') {
    return 'No Pipeline';
  }
  return status.toUpperCase();
}
