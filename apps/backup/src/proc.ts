import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { PassThrough, type Readable, Transform, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** A program in a pipeline: what it reads arrives on stdin, what it writes leaves on stdout. */
export interface Step {
  cmd: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  /** Written to the program's file descriptor 3 and closed: passphrases, never on the command
   *  line or in the environment where `ps` would show them. */
  fd3?: string;
}

export interface Hashed {
  bytes: number;
  sha256: string;
}

/** Counts and hashes what flows through it. */
class Tap extends Transform {
  private readonly hash = createHash("sha256");
  bytes = 0;
  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: () => void) {
    this.hash.update(chunk);
    this.bytes += chunk.length;
    this.push(chunk);
    done();
  }
  result(): Hashed {
    return { bytes: this.bytes, sha256: this.hash.digest("hex") };
  }
}

const tail = (text: string) => text.trim().split("\n").slice(-6).join("\n");

interface Running {
  child: ChildProcess;
  done: Promise<void>;
}

function start(step: Step, stdin: "pipe" | "ignore", stdout: "pipe" | "ignore"): Running {
  const stdio: ("pipe" | "ignore")[] = [stdin, stdout, "pipe"];
  if (step.fd3 !== undefined) stdio.push("pipe");
  const child = spawn(step.cmd, step.args, { stdio, env: { ...process.env, ...step.env } });
  let stderr = "";
  child.stderr?.setEncoding("utf8").on("data", (text: string) => {
    stderr = (stderr + text).slice(-8000);
  });
  if (step.fd3 !== undefined) {
    const extra = child.stdio[3] as Writable;
    extra.on("error", () => {});
    extra.end(step.fd3);
  }
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (error) =>
      reject(
        new Error(
          `${step.cmd}: ${(error as NodeJS.ErrnoException).code === "ENOENT" ? "not installed" : error.message}`,
        ),
      ),
    );
    child.on("close", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`${step.cmd} failed (${signal ?? `exit ${code}`}): ${tail(stderr) || "no message"}`),
          ),
    );
  });
  return { child, done };
}

/** Runs `from` (a program, or a file to read) through `via` (programs) into `to` (a file, or a
 *  program that reads it), hashing what leaves `from` and what reaches `to`. Fails with the first
 *  program's error, if any fails. */
export async function flow(opts: {
  from: Step | { file: string };
  via?: Step[];
  to: { file: string } | Step;
}): Promise<{ first: Hashed; last: Hashed }> {
  const running: Running[] = [];
  const streams: Promise<unknown>[] = [];
  // Looked at once the programs have ended; until then a failure must not count as unhandled.
  const track = (stream: Promise<unknown>) => {
    stream.catch(() => {});
    streams.push(stream);
  };
  let source: Readable;
  if ("file" in opts.from) source = createReadStream(opts.from.file);
  else {
    const producer = start(opts.from, "ignore", "pipe");
    running.push(producer);
    source = producer.child.stdout as Readable;
  }
  const first = new Tap();
  let current: Readable = first;
  track(pipeline(source, first));
  for (const step of opts.via ?? []) {
    const stage = start(step, "pipe", "pipe");
    running.push(stage);
    track(pipeline(current, stage.child.stdin as Writable));
    current = stage.child.stdout as Readable;
  }
  const last = new Tap();
  const out = new PassThrough();
  track(pipeline(current, last, out));
  if ("file" in opts.to) track(pipeline(out, createWriteStream(opts.to.file)));
  else {
    const consumer = start(opts.to, "pipe", "ignore");
    running.push(consumer);
    track(pipeline(out, consumer.child.stdin as Writable));
  }
  // A program's own error says more than the broken pipe it leaves behind.
  const programs = await Promise.allSettled(running.map((r) => r.done));
  const failed = programs.find((p): p is PromiseRejectedResult => p.status === "rejected");
  if (failed) {
    for (const r of running) r.child.kill();
    await Promise.allSettled(streams);
    throw failed.reason;
  }
  await Promise.all(streams);
  return { first: first.result(), last: last.result() };
}

/** Runs a program to the end and returns its stdout. */
export async function run(step: Step): Promise<string> {
  const running = start(step, "ignore", "pipe");
  let out = "";
  running.child.stdout?.setEncoding("utf8").on("data", (text: string) => {
    out += text;
  });
  await running.done;
  return out;
}

/** SHA-256 and size of a file. */
export async function hashFile(file: string): Promise<Hashed> {
  const tap = new Tap();
  await pipeline(createReadStream(file), tap, new PassThrough().resume());
  return tap.result();
}
