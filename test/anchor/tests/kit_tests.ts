import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorBencher } from "../target/types/anchor_bencher";
import { Address, address, appendTransactionMessageInstruction, appendTransactionMessageInstructions, assertIsSendableTransaction, assertIsTransactionWithBlockhashLifetime, Blockhash, createKeyPairSignerFromBytes, createSolanaRpc, createSolanaRpcSubscriptions, createTransactionMessage, generateKeyPairSigner, isSolanaError, KeyPairSigner, Lamports, lamports, pipe, sendAndConfirmTransactionFactory, setTransactionMessageFeePayer, setTransactionMessageFeePayerSigner, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE } from "@solana/kit";
import { getSystemErrorMessage, getTransferSolInstruction, isSystemError } from "@solana-program/system";
import { createRecentSignatureConfirmationPromiseFactory } from "@solana/transaction-confirmation";
import { fromLegacyTransactionInstruction } from "@solana/compat";


describe("kit tests", () => {
  const program = anchor.workspace.anchorBencher as Program<AnchorBencher>;
  anchor.setProvider(anchor.AnchorProvider.env());

  let SOURCE_ACCOUNT_SIGNER: KeyPairSigner;
  let DESTINATION_ACCOUNT_ADDRESS: Address;
  let latestBlockhash: any;
  const rpc = createSolanaRpc('http://127.0.0.1:8899');
  const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');

  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
  });

  before("Is initialized!", async () => {

    SOURCE_ACCOUNT_SIGNER = await createKeyPairSignerFromBytes(
        new Uint8Array(
            [2, 194, 94, 194, 31, 15, 34, 248, 159, 9, 59, 156, 194, 152, 79, 148, 81, 17, 63, 53, 245, 175, 37, 0, 134, 90, 111, 236, 245, 160, 3, 50, 196, 59, 123, 60, 59, 151, 65, 255, 27, 247, 241, 230, 52, 54, 143, 136, 108, 160, 7, 128, 4, 14, 232, 119, 234, 61, 47, 158, 9, 241, 48, 140],
        ), // Address: ED1WqT2hWJLSZtj4TtTdoovmpMrr7zpkUdbfxmcJR1Fq
    );
    DESTINATION_ACCOUNT_ADDRESS = address('GdG9JHTSWBChvf6dfBATEYCZbDwKtcC6tJEpqoyuVfqV');
    const sig = await rpc.requestAirdrop(
      SOURCE_ACCOUNT_SIGNER.address,
      lamports(BigInt(1 * anchor.web3.LAMPORTS_PER_SOL))
    ).send();

    // 3. Confirm the transaction
    const confirmSignature = createRecentSignatureConfirmationPromiseFactory({
        rpc,
        rpcSubscriptions
    });
const abortController = new AbortController();
await confirmSignature({
    signature: sig,
    commitment: 'confirmed',
    abortSignal: abortController.signal,
});

    console.log("Airdrop confirmed!");
    const { value: latestBlockhashTmp } = await rpc.getLatestBlockhash().send();
    latestBlockhash = latestBlockhashTmp;
  });
  it("Is initialized!", async () => {

    let ix = await program.methods.initialize().instruction();
    const instruction = fromLegacyTransactionInstruction(ix);
    const transactionMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (tx) => setTransactionMessageFeePayerSigner(SOURCE_ACCOUNT_SIGNER, tx),
      (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
      (tx) => appendTransactionMessageInstructions([instruction], tx)
    );


    const signedTransaction = await signTransactionMessageWithSigners(
      transactionMessage
    );
    assertIsSendableTransaction(signedTransaction);
    assertIsTransactionWithBlockhashLifetime(signedTransaction);

    try {
        assertIsSendableTransaction(signedTransaction);
        assertIsTransactionWithBlockhashLifetime(signedTransaction);
        await sendAndConfirmTransaction(signedTransaction, { commitment: 'confirmed', skipPreflight: true });
    } catch (e) {
        if (isSolanaError(e, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)) {
            const preflightErrorContext = e.context;
            const preflightErrorMessage = e.message;
            console.error(preflightErrorMessage);
            console.error(preflightErrorContext);
        } else {
            throw e;
        }
    }
  });
  // after(() => {
  //   // Save all benchmarks after the suite completes
  //   getCumulus().saveToFile();
  // });

});
