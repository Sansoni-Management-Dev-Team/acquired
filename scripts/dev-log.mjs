import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { StringDecoder } from "node:string_decoder";

/** Mirror launcher and child output to a fresh, private, tail-able log. */
export function startDevLog(path, stdout = process.stdout, stderr = process.stderr) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const reset = () => {
    writeFileSync(path, "", { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  reset();
  const record = text => appendFileSync(path, stripVTControlCharacters(text));
  const restore = [];
  for (const stream of [stdout, stderr]) {
    const original = stream.write;
    const decoder = new StringDecoder("utf8");
    stream.write = function (chunk, encoding, callback) {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      record(text);
      return original.call(this, chunk, encoding, callback);
    };
    restore.push(() => { stream.write = original; });
  }
  return {
    reset,
    record,
    attach(child) {
      child.stdout.on("data", chunk => stdout.write(chunk));
      child.stderr.on("data", chunk => stderr.write(chunk));
    },
    close() { for (const undo of restore) undo(); },
  };
}
