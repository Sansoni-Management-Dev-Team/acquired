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
    let closedPipe = false;
    const onError = error => {
      if (error.code === "EPIPE") closedPipe = true;
      // Preserve the stream's ordinary error behavior for failures unrelated
      // to a detached terminal. Other existing listeners retain ownership.
      else if (stream.listenerCount("error") === 1) throw error;
    };
    stream.on("error", onError);
    stream.write = function (chunk, encoding, callback) {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      record(text);
      const done = typeof encoding === "function" ? encoding : callback;
      if (closedPipe) {
        if (done) queueMicrotask(() => done());
        return true;
      }
      const complete = done ? error => {
        if (error?.code === "EPIPE") { closedPipe = true; done(); }
        else done(error);
      } : undefined;
      try {
        return original.call(this, chunk, typeof encoding === "string" ? encoding : undefined, complete);
      } catch (error) {
        if (error.code !== "EPIPE") throw error;
        closedPipe = true;
        if (done) queueMicrotask(() => done());
        return true;
      }
    };
    restore.push(() => { stream.write = original; stream.removeListener("error", onError); });
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
