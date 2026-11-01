import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockConfig: Record<string, unknown> = { openRouterApiKey: '', patchTasksEnabled: false, patchPaidCapUsd: 0.25 };

jest.unstable_mockModule('../../../../dist/config/index.js', () => ({ config: mockConfig }));
jest.unstable_mockModule('../../../../dist/utils/logger.js', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule('../../../../dist/modules/core/provider/index.js', () => ({
  getProviderRegistry: () => ({ has: () => false }),
}));

const { toolDefinitionProvider } = await import('../../../../dist/modules/api-integration/tool-definition/index.js');

const patchTool = () => toolDefinitionProvider.getAvailableTools().find(t => t.name === 'patch_task');

describe('patch_task tool definition', () => {
  beforeEach(() => { mockConfig.patchTasksEnabled = false; });

  it('AC3: is not listed while PATCH_TASKS_ENABLED is off', () => {
    expect(patchTool()).toBeUndefined();
    // The other tools are still listed.
    expect(toolDefinitionProvider.getAvailableTools().map(t => t.name)).toContain('get_task_status');
  });

  it('AC3: is listed with its input schema when PATCH_TASKS_ENABLED is on', () => {
    mockConfig.patchTasksEnabled = true;
    const tool = patchTool();
    expect(tool).toBeDefined();
    const schema = tool!.inputSchema as { required: string[]; properties: Record<string, { type: string }> };
    expect(schema.required).toEqual(['goal', 'repo_path']);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['allow_paid', 'checks', 'file_hints', 'goal', 'max_minutes', 'paid_cap_usd', 'repo_path', 'validate'],
    );
    expect(schema.properties.checks.type).toBe('array');
    expect(schema.properties.allow_paid.type).toBe('boolean');
  });

  it('AC8: the description has the git apply instruction, the not-a-sandbox note and the one-model-in-RAM note', () => {
    mockConfig.patchTasksEnabled = true;
    const text = patchTool()!.description;
    expect(text).toMatch(/git apply/);
    expect(text).toMatch(/repo_path/);
    expect(text).toMatch(/ask the user/i);
    expect(text).toMatch(/not a sandbox/i);
    expect(text).toMatch(/run as the user/i);
    expect(text).toMatch(/one local model in RAM/i);
    expect(text).toMatch(/--models-max 1/);
    expect(text).toMatch(/Ollama/);
  });
});
