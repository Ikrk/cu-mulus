import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorBencher } from "../target/types/anchor_bencher";
import { Connection, Keypair } from "@solana/web3.js";

describe("anchor-bencher", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.anchorBencher as Program<AnchorBencher>;
  const user = Keypair.generate();

  before(async () => {
    await airdrop(anchor.getProvider().connection, user);
  });

  it("Is initialized!", async () => {
    const { result, summary } = await bench("my test", async () => {
      const tx = await program.methods.initialize().rpc();
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
    console.log("bench summary", summary);
  });

  it("Composed Tx", async () => {
    const { result, summary } = await bench("composed tx bench", async () => {
      await program.methods.initialize().rpc();
      await program.methods
        .test()
        .accounts({ user: user.publicKey })
        .signers([user])
        .rpc();
    });
    console.log("bench summary", summary);
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

    if (cu) totalCU += cu;
    const item: BenchItem = { sig, cu, ms: timings.get(sig), logs };
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

  // Optionally print summary
  console.table(
    items.map((it) => ({ sig: it.sig, cu: it.cu ?? "-", ms: it.ms ?? "-" }))
  );
  console.log(
    `[bench:${name}] total CU = ${totalCU}, time ms = ${totalTimeMs}`
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
