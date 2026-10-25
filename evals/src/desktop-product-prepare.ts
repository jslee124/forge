import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { prepareDesktopProductRound } from "./desktop-product-evaluation.js";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: { output: { type: "string" }, round: { type: "string" } },
  strict: true,
});
if (!values.output || !["1", "2"].includes(values.round ?? ""))
  throw new Error("Usage: --output <new-directory> --round <1|2>");
const destination = resolve(values.output);
await prepareDesktopProductRound(destination, values.round === "1" ? 1 : 2);
process.stdout.write(
  `Prepared pending baseline inputs at ${destination}; no model calls or scored results.\n`,
);
