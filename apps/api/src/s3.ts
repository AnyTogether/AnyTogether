import { createHash, createHmac } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { Readable } from "node:stream";

/** Enough of the S3 API for the file store: put, get (with a range), head, delete and list, signed
 *  with AWS Signature Version 4. Works with AWS S3, Cloudflare R2, MinIO and the rest; buckets are
 *  addressed by path (https://endpoint/bucket/key). */
export interface S3Settings {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** "auto" for R2; the bucket's region for AWS. */
  region: string;
}

export const emptySha256 = createHash("sha256").update("").digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const hex = (data: string) => createHash("sha256").update(data).digest("hex");
/** RFC 3986 escaping, as SigV4 wants it ("/" kept in paths). */
const rfc3986 = (value: string, keepSlash = false) =>
  encodeURIComponent(value)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, "/");

/** The Authorization header (and the headers it signed) for one request. */
export function signRequest(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadSha256: string;
  accessKey: string;
  secretKey: string;
  region: string;
  now?: Date;
}) {
  const stamp = (input.now ?? new Date())
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v])),
    host: input.url.host,
    "x-amz-content-sha256": input.payloadSha256,
    "x-amz-date": stamp,
  };
  const names = Object.keys(headers).sort();
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [
    input.method,
    rfc3986(decodeURIComponent(input.url.pathname), true),
    query,
    names.map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, " ")}\n`).join(""),
    names.join(";"),
    input.payloadSha256,
  ].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

export interface S3Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Readable;
}

export function s3Client(settings: S3Settings) {
  const base = settings.endpoint.replace(/\/+$/, "");
  const urlOf = (key: string, query: Record<string, string> = {}) => {
    const url = new URL(
      `${base}/${rfc3986(settings.bucket)}/${key
        .split("/")
        .map((p) => rfc3986(p))
        .join("/")}`,
    );
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    return url;
  };

  const send = (
    method: string,
    url: URL,
    options: { headers?: Record<string, string>; body?: Readable; payloadSha256?: string } = {},
  ) =>
    new Promise<S3Response>((resolve, reject) => {
      const headers = signRequest({
        method,
        url,
        headers: options.headers ?? {},
        payloadSha256: options.payloadSha256 ?? emptySha256,
        accessKey: settings.accessKey,
        secretKey: settings.secretKey,
        region: settings.region,
      });
      const req = (url.protocol === "http:" ? httpRequest : httpsRequest)(
        url,
        { method, headers, timeout: 120_000 },
        (res) => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: res }),
      );
      req.on("timeout", () => req.destroy(new Error("S3 request timed out")));
      req.on("error", reject);
      if (options.body) {
        options.body.on("error", (error) => req.destroy(error));
        options.body.pipe(req);
      } else req.end();
    });

  const text = async (body: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  };
  const fail = async (what: string, res: S3Response) => {
    const detail = (await text(res.body).catch(() => "")).slice(0, 300);
    return new Error(`S3 ${what} answered ${res.status}: ${detail}`);
  };

  return {
    async put(key: string, body: Readable, size: number, sha256: string, contentType: string) {
      const res = await send("PUT", urlOf(key), {
        headers: { "content-length": String(size), "content-type": contentType },
        body,
        payloadSha256: sha256,
      });
      if (res.status !== 200) throw await fail(`PUT ${key}`, res);
      res.body.resume();
    },
    /** The object, or a range of it; null when there is none. */
    async get(key: string, range?: { start: number; end: number }) {
      const res = await send("GET", urlOf(key), {
        headers: range ? { range: `bytes=${range.start}-${range.end}` } : {},
      });
      if (res.status === 404) {
        res.body.resume();
        return null;
      }
      if (res.status !== 200 && res.status !== 206) throw await fail(`GET ${key}`, res);
      return res.body;
    },
    async head(key: string) {
      const res = await send("HEAD", urlOf(key));
      res.body.resume();
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`S3 HEAD ${key} answered ${res.status}`);
      return {
        size: Number(res.headers["content-length"] ?? 0),
        modified: new Date(String(res.headers["last-modified"] ?? 0)),
      };
    },
    async delete(key: string) {
      const res = await send("DELETE", urlOf(key));
      if (res.status !== 204 && res.status !== 200 && res.status !== 404)
        throw await fail(`DELETE ${key}`, res);
      res.body.resume();
    },
    /** One page of a listing: keys (with their times) and, with a delimiter, the folders. */
    async list(prefix: string, options: { delimiter?: string; token?: string } = {}) {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (options.delimiter) query.delimiter = options.delimiter;
      if (options.token) query["continuation-token"] = options.token;
      const url = new URL(`${base}/${rfc3986(settings.bucket)}`);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const res = await send("GET", url);
      if (res.status !== 200) throw await fail("LIST", res);
      const xml = await text(res.body);
      const tag = (block: string, name: string) =>
        block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "";
      const unxml = (value: string) =>
        value
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&amp;/g, "&");
      const keys = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
        key: unxml(tag(m[1] ?? "", "Key")),
        modified: new Date(tag(m[1] ?? "", "LastModified")),
      }));
      const folders = [...xml.matchAll(/<CommonPrefixes>([\s\S]*?)<\/CommonPrefixes>/g)].map((m) =>
        unxml(tag(m[1] ?? "", "Prefix")),
      );
      const truncated = tag(xml, "IsTruncated") === "true";
      return { keys, folders, next: truncated ? unxml(tag(xml, "NextContinuationToken")) : null };
    },
  };
}
