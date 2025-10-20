import { Console } from "console";
import { Transform } from "stream";

export const GREEN_BOLD = "\x1b[1;32m";
export const RED_BOLD = "\x1b[1;31m";
export const RESET = "\x1b[0m";

// replaces native console.table to remove the first (index) column
export function table(input: any) {
  // this is a workaround for this table function not supporting colors as toString strips the ANSI sequences
  // therefore we just color the ✓ and ✗ characters manually
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
    r = r.replace(/✓/, `${GREEN_BOLD}✓${RESET}`);
    r = r.replace(/✗/, `${RED_BOLD}✗${RESET}`);
    // Add newline only if not the last row
    result += r;
    if (i < rows.length - 1) result += "\n";
  }
  console.log(result);
}
