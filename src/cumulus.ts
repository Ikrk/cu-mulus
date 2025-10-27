import { Connection } from "@solana/web3.js";
import { BenchSummary } from "./types";
import fs from "fs";
import path from "path";
import { BLUE_BOLD, RESET, YELLOW } from "./utils";

const CUMULUS_DIR = path.join(process.cwd(), "cu-mulus", "results");

export class Cumulus {
  public connection: Connection;
  private results: BenchSummary[] = [];
  private previousResults: BenchSummary[] = [];

  constructor(connection: Connection) {
    this.connection = connection;
    this.previousResults = this.loadPreviousResults();
  }

  add(summary: BenchSummary) {
    this.results.push(summary);
  }

  saveToFile() {
    fs.mkdirSync(CUMULUS_DIR, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(CUMULUS_DIR, `cu-mulus-${timestamp}.json`);

    const bench_json = JSON.stringify(this.results, null, 2);
    fs.writeFileSync(file, bench_json, "utf8");
    console.log(`\n✅ Benchmark saved to: ${file}`);

    // also write/overwrite latest.json for quick access
    fs.writeFileSync(path.join(CUMULUS_DIR, "latest.json"), bench_json);
  }

  loadPreviousResults(): BenchSummary[] {
    const file = path.join(CUMULUS_DIR, "latest.json");

    return this.loadBenchSummaries(file);
  }

  loadBenchSummaries(path: string): BenchSummary[] {
    try {
      if (!fs.existsSync(path)) {
        console.info(`${BLUE_BOLD}INFO${RESET} Previous benchmark file not found: ${path}`);
        return [];
      }

      const file = fs.readFileSync(path, "utf8");
      const data = JSON.parse(file);

      if (!Array.isArray(data)) {
        console.warn(
          `Invalid benchmark file: expected array, got ${typeof data}`,
        );
        return [];
      }

      return data as BenchSummary[];
    } catch (err) {
      console.error(`Failed to load benchmark file ${path}:`, err);
      return [];
    }
  }

  findPreviousBenchByHash(previousBench: BenchSummary): BenchSummary | undefined {
    const found = this.previousResults.filter(
      (b) => b.hash === previousBench.hash,
    );
    if (found.length > 1) {
      console.warn(
        `\n[cu-mulus:${previousBench.name}] ${YELLOW}WARNING${RESET} Multiple ambiguous benchmarks found with the same name and hash (${previousBench.hash}). Could not compare results.`,
      );
      return undefined;
    }
    return found[0];
  }

  get summaries(): BenchSummary[] {
    return this.results;
  }

  clear() {
    this.results = [];
  }
}

let cumulus: Cumulus | null = null;

export function initCumulus(connection: Connection): Cumulus {
  cumulus = new Cumulus(connection);
  return cumulus;
}

export function getCumulus(): Cumulus {
  if (!cumulus) throw new Error("Cumulus not initialized yet");
  return cumulus;
}
