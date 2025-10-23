import { Connection } from "@solana/web3.js";
import { BenchSummary } from "./types";
import fs from "fs";
import path from "path";

export class Cumulus {
  public connection: Connection;
  private results: BenchSummary[] = [];

  constructor(connection: Connection) {
    this.connection = connection;
  }

  add(summary: BenchSummary) {
    this.results.push(summary);
  }

  saveToFile() {
    const dir = path.join(process.cwd(), "cu-mulus", "results");
    fs.mkdirSync(dir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(dir, `cu-mulus-${timestamp}.json`);

    const bench_json = JSON.stringify(this.results, null, 2);
    fs.writeFileSync(file, bench_json, "utf8");
    console.log(`✅ Benchmark saved to: ${file}`);

    // also write/overwrite latest.json for quick access
    fs.writeFileSync(path.join(dir, "latest.json"), bench_json);
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
