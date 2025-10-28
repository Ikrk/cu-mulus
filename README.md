<p align="center">
  <img src="logo.png" alt="CU-mulus Logo" width="300">
</p>

# CU-mulus

CU-mulus is a lightweight and easy-to-set-up TypeScript benchmarking library that helps developers measure and analyze the performance of their Solana programs.

## Features
- 🚀 Benchmark any Solana transaction
- 📈 Collect per-instruction metrics (CUs, nested CPI calls, success/failure)
- 🧩 Compare current vs. previous benchmark results (absolute & relative change)
- 💾 Save benchmark results to a file
- 🎨 Color-coded terminal output for quick performance insights



![CU-mulus Summary Output](cu-mulus.png)

## Installation

### Using npm
```console
npm install cu-mulus
```

### Using yarn
```console
yarn add cu-mulus
```

## Usage

```typescript
import * as anchor from "@coral-xyz/anchor";
import { ExampleProgram } from "../target/types/example_program";
import { bench, getCumulus, initCumulus } from "cu-mulus";

describe("anchor-bencher", () => {
  anchor.setProvider(anchor.AnchorProvider.env());
  let connection = anchor.getProvider().connection;

  // ✅ Initialize CU-mulus
  initCumulus(connection);

  const program = anchor.workspace.exampleProgram as anchor.Program<ExampleProgram>;

  after(() => {
    // 💾 Save all benchmarks after the test suite completes
    getCumulus().saveToFile();
  });

  it("My test", async () => {
   // 🌯 Wrap one or multiple transactions with CU-mulus bench function
    await bench("My init ix bench", async () => {
      await program.methods.initialize().rpc();
    });
  });
});
```
