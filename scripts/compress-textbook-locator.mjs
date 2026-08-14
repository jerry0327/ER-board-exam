import { compressTextbookLocator } from "./lib/textbook-locator-codec.mjs";

const result = compressTextbookLocator();
const ratio = ((result.compressedBytes / result.rawBytes) * 100).toFixed(2);
console.log(
  `Textbook locator index: ${result.rawBytes} bytes → ${result.compressedBytes} bytes `
  + `(${ratio}%, Brotli q11${result.updated ? "" : ", unchanged"})`,
);
