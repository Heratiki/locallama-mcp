import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger.js';
import { config } from '../../config/index.js';

export interface UserPreferences {
  executionMode: 'Fully automated selection' | 'Local model only' | 'Free API only' | 'Paid API only';
  costConfirmationThreshold: number;
  prioritizeRetrivSearch: boolean;
  defaultDirectories: string[];
  excludePatterns: string[];
  maxConcurrentJobs: number;
}

const DEFAULT_PREFERENCES: UserPreferences = {
  executionMode: 'Fully automated selection',
  costConfirmationThreshold: config.costThreshold || 0.02,
  prioritizeRetrivSearch: true,
  defaultDirectories: [],
  excludePatterns: [
    'node_modules/**',
    '.git/**',
    'dist/**',
    'build/**',
    '.venv/**',
    '**/*.min.js',
    '**/*.bundle.js',
    '**/package-lock.json',
    '**/yarn.lock'
  ],
  maxConcurrentJobs: 3
};

class UserPreferencesManager {
  private static instance: UserPreferencesManager;
  private preferences: UserPreferences;
  private preferencesPath: string;
  private initialized: boolean = false;

  private constructor() {
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.preferencesPath = path.join(config.rootDir, 'user-preferences.json');
  }

  static getInstance(): UserPreferencesManager {
    if (!UserPreferencesManager.instance) {
      UserPreferencesManager.instance = new UserPreferencesManager();
    }
    return UserPreferencesManager.instance;
  }

  /**
   * Initialize the user preferences manager
   */
  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.loadPreferences();
      this.initialized = true;
      logger.info('User preferences initialized');
    } catch (error) {
      logger.error('Failed to initialize user preferences', error);
      // Use default preferences if loading fails
      this.preferences = { ...DEFAULT_PREFERENCES };
      this.initialized = true;
    }
  }

  /**
   * Load user preferences from the preferences file
   */
  private async loadPreferences(): Promise<void> {
    try {
      if (fs.existsSync(this.preferencesPath)) {
        const data = fs.readFileSync(this.preferencesPath, 'utf-8');
        const loadedPreferences = JSON.parse(data);
        
        // Merge with defaults to ensure all fields are present
        this.preferences = {
          ...DEFAULT_PREFERENCES,
          ...loadedPreferences
        };
        
        logger.debug('Loaded user preferences from file');
      } else {
        // If the file doesn't exist, create it with default preferences
        await this.savePreferences();
        logger.debug('Created default user preferences file');
      }
    } catch (error) {
      logger.error('Error loading user preferences', error);
      throw error;
    }
  }

  /**
   * Save user preferences to the preferences file
   */
  public async savePreferences(): Promise<void> {
    try {
      const data = JSON.stringify(this.preferences, null, 2);
      fs.writeFileSync(this.preferencesPath, data, 'utf-8');
      logger.debug('Saved user preferences to file');
    } catch (error) {
      logger.error('Error saving user preferences', error);
      throw error;
    }
  }

  /**
   * Get the current user preferences
   */
  public getPreferences(): UserPreferences {
    return { ...this.preferences };
  }

  /**
   * Update user preferences
   * @param newPreferences The new preferences to set
   */
  public async updatePreferences(newPreferences: Partial<UserPreferences>): Promise<UserPreferences> {
    this.preferences = {
      ...this.preferences,
      ...newPreferences
    };
    
    await this.savePreferences();
    return this.getPreferences();
  }

  /**
   * Reset user preferences to defaults
   */
  public async resetPreferences(): Promise<UserPreferences> {
    this.preferences = { ...DEFAULT_PREFERENCES };
    await this.savePreferences();
    return this.getPreferences();
  }
}

export const userPreferencesManager = UserPreferencesManager.getInstance();

/**
 * Load user preferences
 * This is a convenience function for use in other modules
 */
export async function loadUserPreferences(): Promise<UserPreferences> {
  if (!userPreferencesManager.getPreferences().executionMode) {
    await userPreferencesManager.initialize();
  }
  return userPreferencesManager.getPreferences();
}