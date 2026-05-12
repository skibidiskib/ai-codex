import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Integration test: run the full pipeline against the nextjs-app fixture
// and compare every generated .md file to the checked-in expected snapshot.
//
// The pipeline is invoked the same way an end-user would invoke it: via the
// generate-codex.ts CLI entrypoint, with cwd set to the fixture root. This
// exercises CLI arg parsing, framework detection, all generators, and file
// output in one go.
//
// Date handling: each output file starts with `# <kind> (generated YYYY-MM-DD)`.
// We strip the date stamp (replace it with a placeholder) on both sides before
// comparing so the test is not time-dependent.
// ---------------------------------------------------------------------------

const FIXTURE_DIR = path.join(__dirname, 'fixtures/nextjs-app');
const EXPECTED_DIR = path.join(__dirname, 'fixtures/nextjs-app-expected');
const CLI_PATH = path.join(__dirname, '..', 'src/generate-codex.ts');

function stripDateStamp(content: string): string {
  return content.replace(/\(generated \d{4}-\d{2}-\d{2}\)/g, '(generated YYYY-MM-DD)');
}

describe('Next.js pipeline integration', () => {
  it('produces output that matches checked-in snapshots (date-stripped)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-codex-test-'));
    try {
      execSync(`npx tsx ${JSON.stringify(CLI_PATH)} --output ${JSON.stringify(tmpDir)} --quiet`, {
        cwd: FIXTURE_DIR,
        stdio: 'pipe',
      });

      const expectedFiles = fs
        .readdirSync(EXPECTED_DIR)
        .filter((f) => f.endsWith('.md'))
        .sort();

      expect(expectedFiles.length).toBeGreaterThan(0);

      for (const filename of expectedFiles) {
        const expectedPath = path.join(EXPECTED_DIR, filename);
        const actualPath = path.join(tmpDir, filename);

        expect(fs.existsSync(actualPath), `expected output file ${filename} to be generated`).toBe(true);

        const actual = stripDateStamp(fs.readFileSync(actualPath, 'utf-8'));
        const expected = stripDateStamp(fs.readFileSync(expectedPath, 'utf-8'));

        expect(actual, `mismatch in ${filename}`).toBe(expected);
      }

      // Also confirm the pipeline did not produce any unexpected extra files.
      const actualFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.md')).sort();
      expect(actualFiles).toEqual(expectedFiles);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
