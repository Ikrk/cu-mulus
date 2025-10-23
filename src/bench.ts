import { Connection, SendTransactionError } from "@solana/web3.js";
import { BenchIx, BenchSummary, BenchTx, Signature } from "./types";
import { RED_BOLD, RESET, table } from "./utils";

export async function bench<T>(
  name: string,
  connection: Connection,
  fn: () => Promise<T>,
  opts = {
    waitForTx: true,
    getTxRetries: 10,
    getTxDelayMs: 200,
  }
): Promise<{
  result: T;
  summary: BenchSummary;
}> {
  let bench: BenchSummary = {
    name,
    txs: [],
    totalCU: 0,
    totalTimeMs: 0,
  };

  const signatures: Signature[] = [];
  const timings = new Map<string, number>(); // signature -> time in ms (approx)
  let id = 1;

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
        connection
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
        bench.txs.push(tx);
        bench.totalCU += cu;
      } else {
        console.warn(
          `[bench:${name}] \x1b[33m\x1b[1mWARNING:\x1b[0m no logs found for failed transaction #${id++}`
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
        `[bench:${name}] \x1b[33m\x1b[1mWARNING:\x1b[0m no logs found for transaction #${sig.id} - could not parse instruction names and CU values`
      );
    }

    if (cu) bench.totalCU += cu;

    const tx: BenchTx = {
      id: sig.id,
      sig: sig.sig,
      status: "success",
      ixs,
      cu,
      ms: timings.get(sig.sig),
      logs,
    };
    bench.txs.push(tx);
  }

  const totalTimeMs = Date.now() - overallStart;
  bench.totalTimeMs = totalTimeMs;
  // transactions failed during simulation were pushed to the bench first so we need to sort the transactions by id
  bench.txs.sort((a, b) => a.id - b.id);
  printBenchSummary(bench);

  if (error) {
    throw error;
  }

  return { result: result as T, summary: bench };
}

function parseLogsForIxs(logs: string[]): BenchIx[] {
  let level = -1;
  let ixs: BenchIx[][] = [];

  for (let i = 0; i < logs.length; i++) {
    // detect new program invocation
    const matchNewInvocation = logs[i].match(
      /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+invoke\b/
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
      /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+(success|failed)\b/
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

function printBenchSummary(summary: BenchSummary): void {
  console.log(`\n=== Benchmark Summary: ${summary.name} ===`);
  console.log(`Total Transactions: ${summary.txs.length}`);
  console.log(`Total CUs: ${summary.totalCU}`);
  console.log(`Total Time: ${summary.totalTimeMs.toFixed(2)} ms\n`);

  summary.txs.forEach((tx) => {
    // TODO: tx.status can be success but the result can be an error if skipPreflight is true
    // and it is confusing to display a green checkmark in this case
    // const status = tx.status === "success" ? `${GREEN_BOLD}✓${RESET}` : `${RED_BOLD}✗${RESET}`;
    // console.log(`Tx #${tx.id + 1} — ${status} ${tx.sig}`);
    console.log(`Tx #${tx.id} — ${tx.sig}`);
    console.log(`  CUs: ${tx.cu ?? "–"}`);
    console.log(`  Time: ${tx.ms && tx.ms > 0 ? tx.ms.toFixed(2) : "–"} ms`);
    console.log(`  Instructions: ${tx.ixs.length}`);

    // Flatten all nested instructions for table display
    const flattenedIxs = flattenIxs(tx.ixs);
    if (flattenedIxs.length > 0) {
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

          return {
            Level: ix.nestedLevel,
            Instruction: instructionLabel,
            Program: programLabel,
            CUs: cuDisplay,
          };
        })
      );
    }
  });
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
  connection: Connection
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
