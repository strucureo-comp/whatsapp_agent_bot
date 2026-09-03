import inquirer from "inquirer";
import { runEval } from "@/eval/harness.js";

/**
 * Eval command — runs fixtures and reports results.
 */
export async function evalCommand() {
  const { fixturesDir } = await inquirer.prompt([
    {
      type: "input",
      name: "fixturesDir",
      message: "Fixtures directory:",
      default: "./fixtures",
    },
  ]);

  console.log(`\nRunning eval against ${fixturesDir}...\n`);

  const report = await runEval(fixturesDir, { saveHistory: true });

  console.log(`\nEval Results:`);
  console.log(`   Total: ${report.total}`);
  console.log(`   Passed: ${report.passed}`);
  console.log(`   Failed: ${report.failed}`);

  if (report.failed > 0) {
    console.log(`\nFailed fixtures:`);
    for (const result of report.results.filter((r) => !r.passed)) {
      console.log(`   ${result.fixture}`);
      if (result.error) {
        console.log(`     Error: ${result.error}`);
      } else {
        console.log(`     Reply: ${result.reply.slice(0, 100)}...`);
        for (const assertion of result.assertions.filter((a) => !a.passed)) {
          console.log(`     FAIL: ${assertion.name} - ${assertion.detail}`);
        }
      }
    }
  }

  // Assertions summary
  const totalAssertions = report.results.reduce(
    (sum, r) => sum + r.assertions.length,
    0,
  );
  const passedAssertions = report.results.reduce(
    (sum, r) => sum + r.assertions.filter((a) => a.passed).length,
    0,
  );
  console.log(`\nAssertions:`);
  console.log(`   ${passedAssertions}/${totalAssertions} passed`);

  // Tone scores
  const scoredResults = report.results.filter((r) => r.toneScore !== undefined);
  if (scoredResults.length > 0) {
    const avgTone =
      scoredResults.reduce((sum, r) => sum + (r.toneScore ?? 0), 0) /
      scoredResults.length;
    console.log(`\nTone Score:`);
    console.log(`   Average: ${avgTone.toFixed(2)} / 1.00`);
    for (const result of scoredResults) {
      const bar = "\u2588".repeat(Math.round((result.toneScore ?? 0) * 10));
      console.log(`   ${result.fixture}: ${(result.toneScore ?? 0).toFixed(2)} ${bar}`);
    }
  }

  // Cost summary
  console.log(`\nToken Usage:`);
  console.log(`   Input: ${report.totals.input_tokens.toLocaleString()}`);
  console.log(`   Output: ${report.totals.output_tokens.toLocaleString()}`);
  console.log(`   Cache read: ${report.totals.cache_read_tokens.toLocaleString()}`);
  console.log(`   Cache creation: ${report.totals.cache_creation_tokens.toLocaleString()}`);

  // Cost delta vs previous run
  if (report.costDelta) {
    console.log(`\nCost Delta vs Previous Run:`);
    const fmtDelta = (n: number) => (n >= 0 ? `+${n.toLocaleString()}` : n.toLocaleString());
    console.log(`   Input tokens: ${fmtDelta(report.costDelta.input_delta)}`);
    console.log(`   Output tokens: ${fmtDelta(report.costDelta.output_delta)}`);
    console.log(`   Cache read: ${fmtDelta(report.costDelta.cache_delta)}`);
  }
}
