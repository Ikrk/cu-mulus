import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorBencher } from "../target/types/anchor_bencher";
import { Connection, Keypair } from "@solana/web3.js";
import { bench, getCumulus, initCumulus } from "cu-mulus";
import { fromLegacyTransactionInstruction } from "@solana/compat";
import {
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  assertIsSendableTransaction,
  assertIsTransactionMessageWithBlockhashLifetime,
  assertIsTransactionWithinSizeLimit,
  BaseTransactionMessage,
  compileTransaction,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPair,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  pipe,
  SendableTransaction,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  signTransactionMessageWithSigners,
  TransactionMessageWithFeePayer,
} from "@solana/kit";
import {
  estimateComputeUnitLimitFactory,
  getSetComputeUnitLimitInstruction,
} from "@solana-program/compute-budget";

describe("kit tests", () => {
  // Configure the client to use the local cluster.
  // anchor.setProvider(anchor.AnchorProvider.env());
  // let connection = anchor.getProvider().connection;
  // initCumulus(connection); // ✅ initializes internal singleton

  const rpc = createSolanaRpc("http://localhost:8899");
  const rpcSubscriptions = createSolanaRpcSubscriptions("ws://localhost:8900");
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  const program = anchor.workspace.anchorBencher as Program<AnchorBencher>;
  const user = Keypair.generate();

  before(async () => {
    await airdrop(anchor.getProvider().connection, user);
  });
  // after(() => {
  //   // Save all benchmarks after the suite completes
  //   getCumulus().saveToFile();
  // });

  it("Solana sendTransaction (VersionedTransaction)", async () => {
    // const { result, summary } = await bench("my test", async () => {
    // const { blockhash } = await connection.getLatestBlockhash();

    // Send RPC requests.
    // const wallet = address('1234..5678');
    // const { value: balance } = await rpc.getBalance(wallet).send();
    const [payer] = await Promise.all([generateKeyPairSigner()]);

    let ix = await program.methods.initialize().instruction();
    const instruction = fromLegacyTransactionInstruction(ix);
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(payer, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx)
      // (tx) => estimateAndSetComputeUnitLimitFactory(tx)
    );

    // const transaction = compileTransaction(transactionMessage);

    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    assertIsSendableTransaction(signedTransaction);

    signedTransaction satisfies SendableTransaction;
    // assertIsTransactionWithinSizeLimit(signedTransaction);
    // assertIsTransactionMessageWithBlockhashLifetime(signedTransaction);

    const transactionSignature = getSignatureFromTransaction(signedTransaction);
    await sendAndConfirmTransaction(signedTransaction, {
      commitment: "confirmed",
    });

    // tx.sign([anchor.getProvider().wallet.payer]);
    // let sig = await anchor.getProvider().connection.sendTransaction(tx, {skipPreflight: true});
    // await connection.confirmTransaction(
    //   {
    //     signature: sig,
    //     blockhash,
    //     lastValidBlockHeight: (
    //       await connection.getLatestBlockhash()
    //     ).lastValidBlockHeight,
    //   },
    //   "processed"
    // );
    // });
  });

  // it("Anchor rpc send", async () => {
  //   const { result, summary } = await bench("my test", async () => {
  //     await program.methods.initialize().rpc();
  //   });
  // });

  // it("Solana sendTransaction (VersionedTransaction)", async () => {
  //   const { result, summary } = await bench("my test", async () => {
  //     const { blockhash } = await connection.getLatestBlockhash();

  //     let ix = await program.methods.initialize().instruction();
  //     // Create the transaction message
  //     const message = new TransactionMessage({
  //       payerKey: anchor.getProvider().wallet.publicKey,
  //       recentBlockhash: blockhash,
  //       instructions: [ix],
  //     }).compileToV0Message();
  //     let tx = new VersionedTransaction(message);
  //     tx.sign([anchor.getProvider().wallet.payer]);
  //     let sig = await anchor.getProvider().connection.sendTransaction(tx);
  //     await connection.confirmTransaction(
  //       {
  //         signature: sig,
  //         blockhash,
  //         lastValidBlockHeight: (
  //           await connection.getLatestBlockhash()
  //         ).lastValidBlockHeight,
  //       },
  //       "processed"
  //     );
  //   });
  // });

  // it("Missing logs - not waiting for confirmation", async () => {
  //   const { result, summary } = await bench("my test", async () => {
  //     const { blockhash } = await connection.getLatestBlockhash();

  //     let ix = await program.methods.initialize().instruction();
  //     // Create the transaction message
  //     const message = new TransactionMessage({
  //       payerKey: anchor.getProvider().wallet.publicKey,
  //       recentBlockhash: blockhash,
  //       instructions: [ix],
  //     }).compileToV0Message();
  //     let tx = new VersionedTransaction(message);
  //     tx.sign([anchor.getProvider().wallet.payer]);
  //     let sig = await anchor.getProvider().connection.sendTransaction(tx);
  //   });
  // });

  // it("Solana sendTransaction with multiple failed and successful instructions", async () => {
  //   const { result, summary } = await bench("my test", async () => {
  //     const { blockhash } = await connection.getLatestBlockhash();

  //     let ix1 = await program.methods.initialize().instruction();
  //     let ix2 = await program.methods
  //       .test()
  //       .accounts({ user: user.publicKey })
  //       .instruction();
  //     let ix3 = await program.methods.testSimpleError().instruction();
  //     // Create the transaction message
  //     const message = new TransactionMessage({
  //       payerKey: anchor.getProvider().wallet.publicKey,
  //       recentBlockhash: blockhash,
  //       instructions: [ix1, ix2, ix3],
  //     }).compileToV0Message();
  //     let tx = new VersionedTransaction(message);
  //     tx.sign([anchor.getProvider().wallet.payer, user]);
  //     try {
  //       let sig = await anchor.getProvider().connection.sendTransaction(tx);
  //       await connection.confirmTransaction(
  //         {
  //           signature: sig,
  //           blockhash,
  //           lastValidBlockHeight: (
  //             await connection.getLatestBlockhash()
  //           ).lastValidBlockHeight,
  //         },
  //         "confirmed"
  //       );
  //     } catch (error) {
  //       // everything under control
  //     }
  //     // test that the failed transactions will have correct transaction id even if successful transactions are included
  //     await program.methods.test().rpc();
  //     try {
  //       let mint = Keypair.generate();
  //       await program.methods
  //         .testWithError()
  //         .accounts({ user: user.publicKey, mint: mint.publicKey })
  //         .signers([user, mint])
  //         .rpc({ skipPreflight: true });
  //     } catch (error) {
  //       // everything under control
  //     }
  //   });
  // });

  // it("Solana sendAndConfirmTransaction", async () => {
  //   const { result, summary } = await bench("my test", async () => {
  //     const { blockhash } = await connection.getLatestBlockhash();

  //     let tx = await program.methods.initialize().transaction();
  //     let sig = await sendAndConfirmTransaction(connection, tx, [
  //       anchor.getProvider().wallet.payer,
  //     ]);
  //   });
  // });

  // it("Test", async () => {
  //   const { result, summary } = await bench("my test 2", async () => {
  //     const tx = await program.methods
  //       .test()
  //       .accounts({ user: user.publicKey })
  //       .signers([user])
  //       .rpc();
  //   });
  //   // console.log("bench summary", summary);
  // });

  // it("Composed Tx", async () => {
  //   const { result, summary } = await bench("composed tx bench", async () => {
  //     let tx = await program.methods.initialize().rpc();
  //     tx = await program.methods
  //       .test()
  //       .accounts({ user: user.publicKey })
  //       .signers([user])
  //       .rpc();
  //   });
  // });

  // it("CPI", async () => {
  //   const { result, summary } = await bench("cpi bench", async () => {
  //     let mint = Keypair.generate();
  //     await program.methods
  //       .testWithCpi()
  //       .accounts({ user: user.publicKey, mint: mint.publicKey })
  //       .signers([user, mint])
  //       .rpc();
  //   });
  //   // console.log(summary);
  // });

  // it.skip("Error", async () => {
  //   const { result, summary } = await bench("cpi bench", async () => {
  //     let mint = Keypair.generate();
  //     await program.methods
  //       .testWithError()
  //       .accounts({ user: user.publicKey, mint: mint.publicKey })
  //       .signers([user, mint])
  //       .rpc({ skipPreflight: true });
  //   });
  // });
});

async function airdrop(
  connection: Connection,
  user: Keypair,
  amount: number = 100000000
) {
  const tx = await connection.requestAirdrop(user.publicKey, amount);
  await connection.confirmTransaction(tx);
}
function estimateAndSetComputeUnitLimitFactory(
  ...params: Parameters<typeof estimateComputeUnitLimitFactory>
) {
  const estimateComputeUnitLimit = estimateComputeUnitLimitFactory(...params);
  return async <
    T extends BaseTransactionMessage & TransactionMessageWithFeePayer
  >(
    transactionMessage: T
  ) => {
    const computeUnitsEstimate = await estimateComputeUnitLimit(
      transactionMessage
    );
    return appendTransactionMessageInstruction(
      getSetComputeUnitLimitInstruction({ units: computeUnitsEstimate }),
      transactionMessage
    );
  };
}
