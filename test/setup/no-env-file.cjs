// Runs before any module loads: config must not read the repo-root .env under jest (#164).
process.env.LOCALLAMA_ENV_FILE = 'none';
// #163: no test may reach the Stack Exchange API; adapter tests inject a fake fetch.
process.env.PATCH_RESEARCH_STACKEXCHANGE = 'off';
