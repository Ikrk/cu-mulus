import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorBencher } from "../target/types/anchor_bencher";
import {
  Connection,
  Keypair,
  TransactionMessage,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Console } from "console";
import { Transform } from "stream";

describe("anchor-bencher", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.anchorBencher as Program<AnchorBencher>;
  const user = Keypair.generate();

  before(async () => {
    await airdrop(anchor.getProvider().connection, user);
  });

  it("Anchor rpc send", async () => {
    const { result, summary } = await bench("my test", async () => {
      await program.methods.initialize().rpc();
    });
  });

  it("Solana sendTransaction (VersionedTransaction)", async () => {
    const { result, summary } = await bench("my test", async () => {
      let connection = anchor.getProvider().connection;
      const { blockhash } = await connection.getLatestBlockhash();

      let ix = await program.methods.initialize().instruction();
      // Create the transaction message
      const message = new TransactionMessage({
        payerKey: anchor.getProvider().wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      let tx = new VersionedTransaction(message);
      tx.sign([anchor.getProvider().wallet.payer]);
      let sig = await anchor.getProvider().connection.sendTransaction(tx);
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash,
          lastValidBlockHeight: (
            await connection.getLatestBlockhash()
          ).lastValidBlockHeight,
        },
        "processed"
      );
    });
  });

  it("Missing logs - not waiting for confirmation", async () => {
    const { result, summary } = await bench("my test", async () => {
      let connection = anchor.getProvider().connection;
      const { blockhash } = await connection.getLatestBlockhash();

      let ix = await program.methods.initialize().instruction();
      // Create the transaction message
      const message = new TransactionMessage({
        payerKey: anchor.getProvider().wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix],
      }).compileToV0Message();
      let tx = new VersionedTransaction(message);
      tx.sign([anchor.getProvider().wallet.payer]);
      let sig = await anchor.getProvider().connection.sendTransaction(tx);
    });
  });

  it("Solana sendTransaction with multiple instructions", async () => {
    const { result, summary } = await bench("my test", async () => {
      let connection = anchor.getProvider().connection;
      const { blockhash } = await connection.getLatestBlockhash();

      let ix1 = await program.methods.initialize().instruction();
      let ix2 = await program.methods
        .test()
        .accounts({ user: user.publicKey })
        .instruction();
      // Create the transaction message
      const message = new TransactionMessage({
        payerKey: anchor.getProvider().wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: [ix1, ix2],
      }).compileToV0Message();
      let tx = new VersionedTransaction(message);
      tx.sign([anchor.getProvider().wallet.payer, user]);
      let sig = await anchor.getProvider().connection.sendTransaction(tx);
      await connection.confirmTransaction(
        {
          signature: sig,
          blockhash,
          lastValidBlockHeight: (
            await connection.getLatestBlockhash()
          ).lastValidBlockHeight,
        },
        "confirmed"
      );
    });
  });

  it("Solana sendAndConfirmTransaction", async () => {
    const { result, summary } = await bench("my test", async () => {
      let connection = anchor.getProvider().connection;
      const { blockhash } = await connection.getLatestBlockhash();

      let tx = await program.methods.initialize().transaction();
      let sig = await sendAndConfirmTransaction(connection, tx, [
        anchor.getProvider().wallet.payer,
      ]);
    });
  });

  it("Test", async () => {
    const { result, summary } = await bench("my test 2", async () => {
      const tx = await program.methods
        .test()
        .accounts({ user: user.publicKey })
        .signers([user])
        .rpc();
    });
    // console.log("bench summary", summary);
  });

  it("Composed Tx", async () => {
    const { result, summary } = await bench("composed tx bench", async () => {
      let tx = await program.methods.initialize().rpc();
      tx = await program.methods
        .test()
        .accounts({ user: user.publicKey })
        .signers([user])
        .rpc();
    });
  });

  it("CPI", async () => {
    const { result, summary } = await bench("cpi bench", async () => {
      let mint = Keypair.generate();
      await program.methods
        .testWithCpi()
        .accounts({ user: user.publicKey, mint: mint.publicKey })
        .signers([user, mint])
        .rpc();
    });
    // console.log(summary);
  });

  it.skip("Error", async () => {
    const { result, summary } = await bench("cpi bench", async () => {
      let mint = Keypair.generate();
      await program.methods
        .testWithError()
        .accounts({ user: user.publicKey, mint: mint.publicKey })
        .signers([user, mint])
        .rpc({ skipPreflight: true });
    });
  });
});

type BenchTx = {
  sig: string;
  ixs: BenchIx[];
  cu?: number;
  ms?: number;
  logs?: string[];
};

type BenchIx = {
  ixName: string;
  program: string;
  nestedLevel: number;
  cpis: BenchIx[];
  cu?: number;
};

type BenchSummary = {
  name: string;
  txs: BenchTx[];
  totalCU: number;
  totalTimeMs: number;
};

export async function bench<T>(
  name: string,
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
  const connection = anchor.getProvider().connection as Connection;

  const signatures: string[] = [];
  const timings = new Map<string, number>(); // signature -> time in ms (approx)

  // save originals
  const web3 = await import("@solana/web3.js");
  const origSendRawTransaction = (web3.Connection.prototype as any)
    .sendRawTransaction;
  // patch Connection.prototype.sendRawTransaction
  (web3.Connection.prototype as any).sendRawTransaction = async function (
    raw: Buffer,
    opts?: any
  ) {
    const start = Date.now();
    const sig = await origSendRawTransaction.call(this, raw, opts);
    signatures.push(sig);
    timings.set(sig, Date.now() - start);
    return sig;
  };

  // Run the user closure and capture result / errors
  let result: T;
  let error: any;
  const overallStart = Date.now();
  try {
    result = await fn();
  } catch (e) {
    error = e;
  }

  // restore patched methods (important)
  (web3.Connection.prototype as any).sendRawTransaction =
    origSendRawTransaction;

  // If closure threw — rethrow after we finish gathering logs
  // Now fetch transaction details and compute units
  const txs: BenchTx[] = [];
  let totalCU = 0;

  let bench: BenchSummary = {
    name,
    txs: [],
    totalCU: 0,
    totalTimeMs: 0,
  };

  for (const sig of signatures) {
    let txInfo: any = null;
    if (opts.waitForTx) {
      // try to fetch tx for some retries (some nodes are slow to index)
      for (let attempt = 0; attempt < opts.getTxRetries; attempt++) {
        try {
          txInfo = await connection.getTransaction(sig, {
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
      txInfo = await connection.getTransaction(sig, {
        maxSupportedTransactionVersion: 1,
        commitment: "confirmed",
      });
    }

    // console.log(txInfo);
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
        `[bench:${name}] \x1b[33m\x1b[1mWARNING:\x1b[0m no logs found for transaction ${sig} - could not parse instruction names and CU values`
      );
    }

    if (cu) totalCU += cu;

    const tx: BenchTx = { sig, ixs, cu, ms: timings.get(sig), logs };
    txs.push(tx);
  }

  const totalTimeMs = Date.now() - overallStart;
  bench.totalCU = totalCU;
  bench.totalTimeMs = totalTimeMs;
  bench.txs = txs;
  // const summary = { name, items: txs, totalCU, totalTimeMs };

  if (error) {
    // attach summary to error or log
    console.warn(
      `[bench:${name}] error occurred, returning summary so you can debug`,
      bench
    );
    throw error;
  }

  // console.log(
  //   `[bench:${name}] total CU = ${totalCU}, time ms = ${totalTimeMs}`
  // );
  printBenchSummary(bench);
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
      /Program\s+([1-9A-HJ-NP-Za-km-z]{32,44})\s+success\b/
    );
    if (matchInvocationEnd) {
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
  console.log(`Total CU: ${summary.totalCU}`);
  console.log(`Total Time: ${summary.totalTimeMs.toFixed(2)} ms\n`);

  summary.txs.forEach((tx, i) => {
    console.log(`Tx #${i + 1} — ${tx.sig}`);
    console.log(`  CU: ${tx.cu ?? "–"}`);
    console.log(`  Time: ${tx.ms?.toFixed(2) ?? "–"} ms`);
    console.log(`  Instructions: ${tx.ixs.length}`);

    // Flatten all nested instructions for table display
    const flattenedIxs = flattenIxs(tx.ixs);
    if (flattenedIxs.length > 0) {
      table(
        flattenedIxs.map((ix) => ({
          Level: ix.nestedLevel,
          Instruction: ix.nestedLevel === 0 ? `* ${ix.ixName}` : `${" ".repeat(ix.nestedLevel * 2)}${ix.ixName}`,
          Program: `${" ".repeat(ix.nestedLevel * 2)}${ix.program}`,
          CU: ix.cu && ix.cu > 0 ? ix.cu : "-",
        }))
      );
    }
  });
}

/**
 * Recursively flatten all nested instructions (CPIs)
 */
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

async function airdrop(
  connection: Connection,
  user: Keypair,
  amount: number = 100000000
) {
  const tx = await connection.requestAirdrop(user.publicKey, amount);
  await connection.confirmTransaction(tx);
}

// replaces native console.table to remove the first (index) column
function table(input) {
  // @see https://stackoverflow.com/a/67859384
  const ts = new Transform({
    transform(chunk, enc, cb) {
      cb(null, chunk);
    },
  });
  const logger = new Console({ stdout: ts });
  logger.table(input);
  const table = (ts.read() || "").toString();
  let result = "";

  const rows = table.split(/[\r\n]+/);
  for (let i = 0; i < rows.length; i++) {
    let row = rows[i];
    let r = row.replace(/[^┬]*┬/, "┌");
    r = r.replace(/^├─*┼/, "├");
    r = r.replace(/│[^│]*/, "");
    r = r.replace(/^└─*┴/, "└");
    r = r.replace(/'/g, " ");
    // Add newline only if not the last row
    result += r;
    if (i < rows.length - 1) result += "\n";
  }
  console.log(result);
}
