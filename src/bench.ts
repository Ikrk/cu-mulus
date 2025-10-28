import { Connection, SendTransactionError } from "@solana/web3.js";
import { BenchIx, BenchSummary, BenchTx, Signature } from "./types";
import { BLUE_BOLD, GREEN_BOLD, RED_BOLD, RESET, table, YELLOW } from "./utils";
import { Cumulus, getCumulus } from "./cumulus";
import crypto from "crypto";

export async function bench<T>(
  name: string,
  fn: () => Promise<T>,
  opts = {
    waitForTx: true,
    getTxRetries: 10,
    getTxDelayMs: 200,
  },
  cumulusInstance: Cumulus = getCumulus(),
): Promise<{
  result: T;
  summary: BenchSummary;
}> {
  let benchSummary: BenchSummary = {
    name,
    hash: "",
    txs: [],
    totalCU: 0,
    totalTimeMs: 0,
  };

  const signatures: Signature[] = [];
  const timings = new Map<string, number>(); // signature -> time in ms (approx)
  let id = 1;

  let connection = cumulusInstance.connection;
  // save originals
  const origSendRawTransaction = connection.sendRawTransaction.bind(connection);
  // patch Connection.prototype.sendRawTransaction
  connection.sendRawTransaction = async function (raw: Buffer, opts?: any) {
    const start = Date.now();
    try {
      const sig = await origSendRawTransaction.call(this, raw, opts);
      const s: Signature = { id: id++, sig };
      signatures.push(s);
      timings.set(sig, Date.now() - start);
      return sig;
    } catch (err) {
      // catch failed transaction simulation
      const logs = await extractErrorLogs(
        err as SendTransactionError,
        connection,
      );
      if (logs) {
        const ixs = parseLogsForIxs(logs);
        let cu = 0;
        ixs.forEach((ix) => {
          cu += ix.cu ?? 0;
        });
        const tx: BenchTx = {
          id: id++,
          sig: `${RED_BOLD}✗${RESET} Failed during simulation`,
          status: "failed",
          ixs,
          cu,
          ms: 0,
          logs: logs,
        };
        benchSummary.txs.push(tx);
        benchSummary.totalCU += cu;
      } else {
        console.warn(
          `[cu-mulus:${name}] \x1b[33m\x1b[1mWARNING:\x1b[0m no logs found for failed transaction #${id++}`,
        );
      }
      throw err;
    }
  };

  // Run the user closure and capture result / errors
  let result: T | undefined;
  let error: any;
  const overallStart = Date.now();
  try {
    result = await fn();
  } catch (e) {
    error = e;
  }

  // restore patched methods (important)
  connection.sendRawTransaction = origSendRawTransaction;

  // If closure threw — rethrow after we finish gathering logs
  // Now fetch transaction details and compute units
  for (const sig of signatures) {
    let txInfo: any = null;
    if (opts.waitForTx) {
      // try to fetch tx for some retries (some nodes are slow to index)
      for (let attempt = 0; attempt < opts.getTxRetries; attempt++) {
        try {
          txInfo = await connection.getTransaction(sig.sig, {
            maxSupportedTransactionVersion: 1,
            commitment: "confirmed",
          });
        } catch (e) {
          txInfo = null;
        }
        if (txInfo && txInfo.meta) break;
        // wait then retry
        await new Promise((r) => setTimeout(r, opts.getTxDelayMs));
      }
    } else {
      txInfo = await connection.getTransaction(sig.sig, {
        maxSupportedTransactionVersion: 1,
        commitment: "confirmed",
      });
    }

    const logs: string[] | undefined = txInfo?.meta?.logMessages;
    // Newer runtime may set computeUnitsConsumed in meta; fallback to parsing logs
    let cu: number | undefined =
      txInfo?.meta?.computeUnitsConsumed ?? undefined;
    if (!cu && logs) {
      // parse last occurrence of 'consumed N of' pattern
      for (let i = logs.length - 1; i >= 0; i--) {
        const m = logs[i].match(/consumed\s+(\d+)\s+of/i);
        if (m) {
          cu = Number(m[1]);
          break;
        }
      }
    }
    let ixs: BenchIx[] = [];
    if (logs) {
      // parse logs
      ixs = parseLogsForIxs(logs);
    } else {
      console.warn(
        `[cu-mulus:${name}] ${YELLOW}WARNING${RESET} no logs found for transaction #${sig.id} - could not parse instruction names and CU values`,
      );
    }

    if (cu) benchSummary.totalCU += cu;

    const tx: BenchTx = {
      id: sig.id,
      sig: sig.sig,
      status: "success",
      ixs,
      cu,
      ms: timings.get(sig.sig),
      logs,
    };
    benchSummary.txs.push(tx);
  }

  const totalTimeMs = Date.now() - overallStart;
  benchSummary.totalTimeMs = totalTimeMs;
  // transactions failed during simulation were pushed to the bench first so we need to sort the transactions by id
  benchSummary.txs.sort((a, b) => a.id - b.id);
  benchSummary.hash = computeBenchHash(benchSummary);

  // load previous results for comparison
  const previousBenchSummary =
    cumulusInstance.findPreviousBenchByHash(benchSummary);
  printBenchSummary(benchSummary, previousBenchSummary);
  cumulusInstance.add(benchSummary);

  if (error) {
    throw error;
  }

  return { result: result as T, summary: benchSummary };
}

function parseLogsForIxs(logs: string[]): BenchIx[] {
  let level = -1;
  let ixs: BenchIx[][] = [];

  for (let i = 0; i < logs.length; i++) {
    // detect new program invocation
    const matchNewInvocation = logs[i].match(
      /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+invoke\b/,
    );
    if (matchNewInvocation) {
      level++;
      let programAddress = matchNewInvocation
        ? matchNewInvocation[1]
        : "unknown program";
      let newIx: BenchIx = {
        ixName: "unknown",
        status: "unknown",
        program: programAddress,
        nestedLevel: level,
        cpis: [],
        cu: 0,
      };
      if (ixs.length - 1 < level) {
        ixs.push([]);
      }
      ixs[level].push(newIx);
      continue;
    }
    // detect instruction mame
    const matchIxName = logs[i].match(/Instruction:\s+([^\s]+)/);
    if (matchIxName) {
      let ixName = matchIxName ? matchIxName[1] : "unknown ix";
      if (ixs.length > 0) {
        ixs[level][ixs[level].length - 1].ixName = ixName;
      }
      continue;
    }
    // detect consumed units
    const matchCUs = logs[i].match(/consumed\s+(\d+)\s+of/i);
    if (matchCUs) {
      let cu = Number(matchCUs[1]);
      ixs[level][ixs[level].length - 1].cu = cu;
      continue;
    }
    // detect end of program invocation mame
    const matchInvocationEnd = logs[i].match(
      /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+(success|failed)\b/,
    );
    if (matchInvocationEnd) {
      let status = matchInvocationEnd[2];
      ixs[level][ixs[level].length - 1].status = status;
      if (ixs.length > level) {
        // save the cpis to last ix at the current level
        ixs[level][ixs[level].length - 1].cpis = ixs[level + 1];
        // reset nested cpis
        ixs[level + 1] = [];
      }
      level--;
      continue;
    }
  }
  return ixs[0] ?? [];
}

function computeBenchHash(summary: BenchSummary): string {
  const data = {
    name: summary.name,
    txs: summary.txs.map((tx) => ({
      id: tx.id,
      ixs: tx.ixs.map((ix) => ({
        ixName: ix.ixName,
      })),
    })),
  };
  const json = JSON.stringify(data);
  return crypto.createHash("sha256").update(json).digest("hex");
}

function printBenchSummary(
  summary: BenchSummary,
  previousSummary?: BenchSummary,
): void {
  console.log(`\n${BLUE_BOLD}☁️  CU-mulus Summary:${RESET} ${summary.name}`);
  console.log(`Total Transactions: ${summary.txs.length}`);
  console.log(
    `Total CUs: ${summary.totalCU} ${
      previousSummary
        ? "(change: " +
          stringifyAndFormatChange(summary.totalCU, previousSummary.totalCU) +
          ")"
        : ""
    }`,
  );
  console.log(`Total Time: ${summary.totalTimeMs.toFixed(2)} ms`);
  // TODO add comparison of each transaction and its individual instructions

  console.log(""); // extra line for spacing

  summary.txs.forEach((tx, i) => {
    const prevTx = previousSummary?.txs[i]; // undefined if no previous or shorter array
    // TODO: tx.status can be success but the result can be an error if skipPreflight is true
    // and it is confusing to display a green checkmark in this case
    // const status = tx.status === "success" ? `${GREEN_BOLD}✓${RESET}` : `${RED_BOLD}✗${RESET}`;
    // console.log(`Tx #${tx.id + 1} — ${status} ${tx.sig}`);
    console.log(`Tx #${tx.id} — ${tx.sig}`);
    console.log(
      `  CUs: ${
        tx.cu
          ? tx.cu +
            (prevTx?.cu
              ? " (change: " + stringifyAndFormatChange(tx.cu, prevTx.cu) + ")"
              : "")
          : "-"
      }`,
    );
    console.log(`  Time: ${tx.ms && tx.ms > 0 ? tx.ms.toFixed(2) : "–"} ms`);
    console.log(`  Instructions: ${tx.ixs.length}`);

    // Flatten all nested instructions for table display
    const flattenedIxs = flattenIxs(tx.ixs);
    if (flattenedIxs.length > 0) {
      let baseLevelIndex = 0;
      table(
        flattenedIxs.map((ix) => {
          const indent = " ".repeat(ix.nestedLevel * 2);
          const isRoot = ix.nestedLevel === 0;
          const cuDisplay = ix.cu && ix.cu > 0 ? ix.cu : "-";
          const status = ix.status === "success" ? `✓` : `✗`;
          const instructionLabel = isRoot
            ? `${status} ${ix.ixName}`
            : `${indent}${status} ${ix.ixName}`;

          const programLabel = `${indent}${ix.program}`;

          // We want to show change column only if previousSummary is defined
          if (previousSummary) {
            let change = "-";
            // We show change only if we are at the root level - when calculating the unique
            // bench hash, instruction cpis are not taken into account. In other words a bench summary
            // to be considered the same must have the same name and transactions with the same root-level
            // instructions. CPI calls are not taken into account so we are not showing change for them.
            if (isRoot && ix.cu) {
              const prevIx = prevTx?.ixs[baseLevelIndex++];
              change = prevIx?.cu
                ? stringifyChange(ix.cu, prevIx.cu)
                : "";
            }
            return {
              Level: ix.nestedLevel,
              Instruction: instructionLabel,
              Program: programLabel,
              CUs: cuDisplay,
              Change: change,
            };
          }
          // Previous summary is undefined so we are not showing changes.
          return {
            Level: ix.nestedLevel,
            Instruction: instructionLabel,
            Program: programLabel,
            CUs: cuDisplay,
          };
        }),
      );
    }
  });
}

function stringifyAndFormatChange(current: number, previous: number): string {
  const absoluteChange = current - previous;
  const relativeChange =
    previous !== 0 ? (absoluteChange / previous) * 100 : NaN;

  const color =
    absoluteChange < 0 ? GREEN_BOLD : absoluteChange > 0 ? RED_BOLD : "";

  const sign = absoluteChange > 0 ? "+" : "";

  const changeMessage =
    `${color}${sign}${absoluteChange}${RESET} CUs ` +
    `/ ${!isNaN(relativeChange) ? color + sign + relativeChange.toFixed(2) + RESET + " %" : "N/A"}${RESET}`;

  return changeMessage;
}

function stringifyChange(current: number, previous: number): string {
  const absoluteChange = current - previous;
  const relativeChange =
    previous !== 0 ? (absoluteChange / previous) * 100 : NaN;

  const sign = absoluteChange > 0 ? "+" : "";

  const changeMessage =
    `${sign}${absoluteChange} CUs ` +
    `/ ${!isNaN(relativeChange) ? sign + relativeChange.toFixed(2) + " %" : "N/A"}`;

  return changeMessage;
}

//  Recursively flatten all nested instructions (CPIs)
function flattenIxs(ixs: BenchIx[], level = 0): BenchIx[] {
  const result: BenchIx[] = [];
  for (const ix of ixs) {
    const copy = { ...ix, nestedLevel: level };
    result.push(copy);
    if (ix.cpis && ix.cpis.length > 0) {
      result.push(...flattenIxs(ix.cpis, level + 1));
    }
  }
  return result;
}

async function extractErrorLogs(
  err: SendTransactionError,
  connection: Connection,
): Promise<string[] | null> {
  let logs: string[] | null = null;

  if (typeof err.getLogs === "function") {
    // Newer API (async)
    try {
      logs = await err.getLogs(connection);
    } catch {
      logs = err.logs ?? null;
    }
  } else {
    // Legacy API (sync)
    logs = err.logs ?? null;
  }

  return logs;
}
