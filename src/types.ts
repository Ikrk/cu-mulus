
export type BenchTx = {
  id: number;
  sig: string;
  status: string;
  ixs: BenchIx[];
  cu?: number;
  ms?: number;
  logs?: string[];
};

export type BenchIx = {
  ixName: string;
  status: string;
  program: string;
  nestedLevel: number;
  cpis: BenchIx[];
  cu?: number;
};

export type BenchSummary = {
  name: string;
  txs: BenchTx[];
  totalCU: number;
  totalTimeMs: number;
};

export type Signature = {
  id: number;
  sig: string;
};
