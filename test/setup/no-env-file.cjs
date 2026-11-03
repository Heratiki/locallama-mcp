// Runs before any module loads: config must not read the repo-root .env under jest (#164).
process.env.LOCALLAMA_ENV_FILE = 'none';
