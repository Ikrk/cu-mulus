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
        "confirmed"
      );
    });
  });

  it.only("Solana sendTransaction with multiple instructions", async () => {
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
      let userAccount = Keypair.generate();
      await program.methods
        .testWithCpi()
        .accounts({ user: user.publicKey, userAccount: userAccount.publicKey })
        .signers([user, userAccount])
        .rpc();
    });
  });

  // async function bench(name: string, fn: () => Promise<void>) {
  //   console.log(`🏁 Benchmark: ${name}`);
  //   const signatures: string[] = [];
  //   const originalRpc = program.methods.initialize().rpc;
  //   program.methods.initialize().rpc = async () => {
  //     const tx = await originalRpc.call(program.methods.initialize());
  //     signatures.push(tx);
  //     console.log("Test from bench");
  //     return tx;
  //   };

  //   // Save original send
  //   const originalSend = anchor.AnchorProvider.local().sendAndConfirm;

  //   // Monkey-patch provider.sendAndConfirm
  //   anchor.AnchorProvider.local().sendAndConfirm = async (tx, signers, opts) => {
  //     const sig = await originalSend.call(anchor.AnchorProvider.local(), tx, signers, opts);
  //     signatures.push(sig);
  //     return sig;
  //   };

  //   // Execute the test closure
  //   await fn();

  //   // Restore original
  //   program.methods.initialize().rpc = originalRpc;
  //   anchor.AnchorProvider.local().sendAndConfirm = originalSend;
  //   console.log("signatures:", signatures);

  //   // Fetch and analyze logs
  //   for (const sig of signatures) {
  //     const txInfo = await program.provider.connection.getTransaction(sig, {
  //           maxSupportedTransactionVersion: 1,
  //           commitment: "confirmed",
  //         });
  //     const logs = txInfo?.meta?.logMessages || [];
  //     const cuLog = logs.find(l => l.includes("consumed"));
  //     console.log(`🧾 ${sig}: ${cuLog}`);
  //   }
  // }
});

type BenchItem = {
  sig: string;
  ixName: string;
  cu?: number;
  ms?: number;
  logs?: string[];
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
  summary: {
    name: string;
    items: BenchItem[];
    totalCU: number;
    totalTimeMs: number;
  };
}> {
  const connection = anchor.getProvider().connection as Connection;
  const provider = anchor.getProvider() as any;

  const signatures: string[] = [];
  const timings = new Map<string, number>(); // signature -> time in ms (approx)

  // save originals
  const web3 = await import("@solana/web3.js");
  const origSendTransaction = (web3.Connection.prototype as any)
    .sendTransaction;
  const origSendRawTransaction = (web3.Connection.prototype as any)
    .sendRawTransaction;
  const origProviderSend =
    provider && provider.sendAndConfirm
      ? provider.sendAndConfirm.bind(provider)
      : null;

  // // patch Connection.prototype.sendTransaction
  // (web3.Connection.prototype as any).sendTransaction = async function (
  //   tx: any,
  //   signers?: any[],
  //   opts?: any
  // ) {
  //   const start = Date.now();
  //   const sig = await origSendTransaction.call(this, tx, signers, opts);
  //   signatures.push(sig);
  //   timings.set(sig, Date.now() - start);
  //   return sig;
  // };

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

  // patch provider.sendAndConfirm if present (extra safety)
  // if (origProviderSend) {
  //   (provider as any).sendAndConfirm = async function (
  //     tx: any,
  //     signers?: any[],
  //     opts?: any
  //   ) {
  //     const start = Date.now();
  //     const sig = await origProviderSend(tx, signers, opts);
  //     signatures.push(sig);
  //     timings.set(sig, Date.now() - start);
  //     return sig;
  //   };
  // }

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
  // (web3.Connection.prototype as any).sendTransaction = origSendTransaction;
  (web3.Connection.prototype as any).sendRawTransaction =
    origSendRawTransaction;
  // if (origProviderSend) (provider as any).sendAndConfirm = origProviderSend;

  // If closure threw — rethrow after we finish gathering logs
  // Now fetch transaction details and compute units
  const items: BenchItem[] = [];
  let totalCU = 0;

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

    console.log(txInfo);
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
    let ixName = "unknown";
    if (logs) {
      // parse first occurrence of 'Instruction: ' pattern
      for (let i = 0; i < logs.length; i++) {
        const m = logs[i].match(/Instruction:\s+([^\s]+)/);
        if (m) {
          ixName = m ? m[1] : "unknown";
          break;
        }
      }
    }

    if (cu) totalCU += cu;
    const item: BenchItem = { sig, ixName, cu, ms: timings.get(sig), logs };
    items.push(item);
  }

  const totalTimeMs = Date.now() - overallStart;

  const summary = { name, items, totalCU, totalTimeMs };

  if (error) {
    // attach summary to error or log
    console.warn(
      `[bench:${name}] error occurred, returning summary so you can debug`,
      summary
    );
    throw error;
  }

  console.log(
    `[bench:${name}] total CU = ${totalCU}, time ms = ${totalTimeMs}`
  );
  table(
    items.map((it) => ({
      txSig: it.sig,
      ixName: it.ixName,
      CUs: it.cu ?? "-",
      ms: it.ms ?? "-",
    }))
  );

  return { result: result as T, summary };
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
  for (let row of table.split(/[\r\n]+/)) {
    let r = row.replace(/[^┬]*┬/, "┌");
    r = r.replace(/^├─*┼/, "├");
    r = r.replace(/│[^│]*/, "");
    r = r.replace(/^└─*┴/, "└");
    r = r.replace(/'/g, " ");
    result += `${r}\n`;
  }
  console.log(result);
}
