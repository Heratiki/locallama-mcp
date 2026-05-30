import net from 'net';
import { spawn, ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import axios from 'axios';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

export class LlamaServerManager {
  private child: ChildProcess | null = null;
  private restartCount = 0;
  private isStopping = false;
  private lastBinaryPath: string | null = null;
  private lastModelPath: string | null = null;
  private lastPort: number | null = null;
  private lastExtraFlags: string[] = [];

  /**
   * Get the current restart count.
   */
  getRestartCount(): number {
    return this.restartCount;
  }

  /**
   * Find a free port starting from the given port.
   */
  async findFreePort(startPort: number): Promise<number> {
    let port = startPort;
    while (port < 65535) {
      if (await this.isPortFree(port)) {
        return port;
      }
      port++;
    }
    throw new Error('No free ports found');
  }

  private isPortFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.listen(port, () => {
        server.close(() => resolve(true));
      });
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  /**
   * Spawn llama-server as a child process and wait for readiness.
   * @param extraFlags - Additional flags to append (from GGUF metadata + user overrides)
   */
  async spawnServer(binaryPath: string, modelPath: string, port: number, extraFlags: string[] = []): Promise<void> {
    this.lastBinaryPath = binaryPath;
    this.lastModelPath = modelPath;
    this.lastPort = port;
    this.lastExtraFlags = extraFlags;
    this.isStopping = false;

    const args = [
      '--model', modelPath,
      '--port', port.toString(),
      '--no-mmap',
      ...extraFlags,
    ];

    logger.info(`Spawning llama-server: ${binaryPath} ${args.join(' ')}`);

    this.child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (this.child.stdout) {
      const rl = createInterface({ input: this.child.stdout });
      rl.on('line', (line) => {
        logger.info(`[llama-server] ${line}`);
      });
    }

    if (this.child.stderr) {
      const rl = createInterface({ input: this.child.stderr });
      rl.on('line', (line) => {
        logger.warn(`[llama-server] ${line}`);
      });
    }

    this.child.on('exit', (code, signal) => {
      logger.info(`llama-server exited with code ${code} and signal ${signal}`);
      this.child = null;

      if (!this.isStopping) {
        this.handleRestart();
      }
    });

    this.child.on('error', (err) => {
      logger.error(`llama-server error: ${err.message}`);
    });

    // Wait for readiness
    const startTime = Date.now();
    const timeout = config.llamaCppStartupTimeoutMs;
    const url = `http://localhost:${port}/v1/models`;

    while (Date.now() - startTime < timeout) {
      if (!this.child && !this.isStopping) {
        // If it exited during startup, it might be retrying already or failed
        // But for the initial spawn call, we want to know if it failed.
        throw new Error('llama-server exited unexpectedly during startup');
      }

      try {
        await axios.get(url, { timeout: 1000 });
        logger.info('llama-server is ready');
        this.restartCount = 0; // Reset restart count on successful readiness
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (this.child) {
      logger.error(`llama-server failed to start within ${timeout}ms, killing process`);
      this.child.kill('SIGKILL');
    }
    throw new Error(`llama-server failed to start within ${timeout}ms`);
  }

  private handleRestart(): void {
    if (this.restartCount >= 5) {
      logger.error('llama-server failed to restart after 5 attempts, giving up');
      return;
    }

    const backoff = Math.min(1000 * Math.pow(2, this.restartCount), 60000);
    this.restartCount++;

    logger.info(`Scheduling llama-server restart in ${backoff}ms (attempt ${this.restartCount})`);

    setTimeout(async () => {
      if (this.lastBinaryPath && this.lastModelPath && this.lastPort !== null && !this.isStopping) {
        try {
          await this.spawnServer(this.lastBinaryPath, this.lastModelPath, this.lastPort, this.lastExtraFlags);
        } catch (error) {
          logger.error(`Failed to restart llama-server: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }, backoff);
  }

  /**
   * Stop the managed server.
   */
  async stopServer(): Promise<void> {
    this.isStopping = true;
    if (!this.child) return;

    logger.info('Stopping managed llama-server');
    this.child.kill('SIGTERM');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.child) {
          logger.warn('llama-server did not exit gracefully, killing with SIGKILL');
          this.child.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      this.child?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}
