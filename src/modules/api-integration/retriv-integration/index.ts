import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../../utils/logger.js';
import { BM25Options } from '../../cost-monitor/bm25.js';
import { codeSearchEngineManager } from '../../cost-monitor/codeSearchEngine.js';
import { IRetrivIntegration } from '../types.js';

export class RetrivIntegration implements IRetrivIntegration {
  isPythonAvailable(): boolean {
    try {
      execSync('python --version', { stdio: 'pipe' });
      return true;
    } catch (error) {
      try {
        execSync('python3 --version', { stdio: 'pipe' });
        return true;
      } catch (error) {
        return false;
      }
    }
  }

  isPythonModuleInstalled(moduleName: string): boolean {
    try {
      execSync(`python -c "import ${moduleName}"`, { stdio: 'pipe' });
      return true;
    } catch (error) {
      return false;
    }
  }

  generateRequirementsTxt(): string {
    const requirementsPath = path.join(process.cwd(), 'retriv-requirements.txt');
    const dependencies = [
      'retriv>=0.3.1',
      'numpy>=1.22.0',
      'scikit-learn>=1.0.2',
      'scipy>=1.8.0'
    ];
    fs.writeFileSync(requirementsPath, dependencies.join('\n'));
    return requirementsPath;
  }

  async initializeRetriv(directories: string[], forceReindex: boolean): Promise<void> {
    if (!this.isPythonAvailable()) {
      throw new Error('Python is not installed or not available in PATH. Python is required for Retriv functionality.');
    }
    const retrivInstalled = this.isPythonModuleInstalled('retriv');
    if (!retrivInstalled) {
      const requirementsPath = this.generateRequirementsTxt();
      execSync(`pip install -r ${requirementsPath}`, { stdio: 'inherit' });
      fs.unlinkSync(requirementsPath);
    }
    await codeSearchEngineManager.initialize({
      excludePatterns: undefined,
      chunkSize: undefined,
      bm25Options: undefined,
    });
    for (const directory of directories) {
      await codeSearchEngineManager.indexDirectory(directory, forceReindex);
    }
  }
}

const retrivIntegration = new RetrivIntegration();

export { retrivIntegration };
export const isPythonAvailable = retrivIntegration.isPythonAvailable.bind(retrivIntegration);
export const isPythonModuleInstalled = retrivIntegration.isPythonModuleInstalled.bind(retrivIntegration);
export const generateRequirementsTxt = retrivIntegration.generateRequirementsTxt.bind(retrivIntegration);
export const initializeRetriv = retrivIntegration.initializeRetriv.bind(retrivIntegration);
