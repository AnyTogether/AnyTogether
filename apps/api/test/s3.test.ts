import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { s3Store } from "../src/fileStore.js";
import { emptySha256, signRequest } from "../src/s3.js";
import { harness } from "./harness.js";

describe("S3 signatures", () => {
  it("match AWS's documented example (GET Object with a range)", () => {
    const headers = signRequest({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: { range: "bytes=0-9" },
      payloadSha256: emptySha256,
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(headers.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41",
    );
  });
});

/** A pretend bucket: objects in memory, the SHA-256 S3 checks, ranges and listings. */
function fakeS3() {
  const objects = new Map<string, { bytes: Buffer; type: string; modified: Date }>();
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push(`${req.method} ${url.pathname}`);
    if (!String(req.headers.authorization ?? "").startsWith("AWS4-HMAC-SHA256 Credential=key/")) {
      res.writeHead(403).end();
      return;
    }
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = decodeURIComponent(rest.join("/"));
    if (bucket !== "saves") return res.writeHead(404).end();
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const bytes = Buffer.concat(chunks);
      if (createHash("sha256").update(bytes).digest("hex") !== req.headers["x-amz-content-sha256"])
        return res.writeHead(400).end("<Error><Code>XAmzContentSHA256Mismatch</Code></Error>");
      objects.set(key, { bytes, type: String(req.headers["content-type"]), modified: new Date() });
      return res.writeHead(200).end();
    }
    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = url.searchParams.get("prefix") ?? "";
      const delimiter = url.searchParams.get("delimiter");
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const folders = delimiter ? [...new Set(keys.map((k) => k.slice(0, k.indexOf("/") + 1)))] : [];
      const contents = delimiter ? [] : keys;
      return res
        .writeHead(200, { "content-type": "application/xml" })
        .end(
          `<?xml version="1.0"?><ListBucketResult>${contents
            .map(
              (k) =>
                `<Contents><Key>${k}</Key><LastModified>${objects.get(k)?.modified.toISOString()}</LastModified></Contents>`,
            )
            .join(
              "",
            )}${folders.map((f) => `<CommonPrefixes><Prefix>${f}</Prefix></CommonPrefixes>`).join("")}<IsTruncated>false</IsTruncated></ListBucketResult>`,
        );
    }
    const found = objects.get(key);
    if (req.method === "DELETE") {
      objects.delete(key);
      return res.writeHead(204).end();
    }
    if (!found) return res.writeHead(404).end();
    if (req.method === "HEAD")
      return res
        .writeHead(200, {
          "content-length": found.bytes.length,
          "last-modified": found.modified.toUTCString(),
        })
        .end();
    const range = String(req.headers.range ?? "").match(/^bytes=(\d+)-(\d+)$/);
    if (range) return res.writeHead(206).end(found.bytes.subarray(Number(range[1]), Number(range[2]) + 1));
    return res.writeHead(200, { "content-type": found.type }).end(found.bytes);
  });
  return { server, objects, requests };
}

describe("the S3 store", () => {
  const fake = fakeS3();
  let endpoint = "";
  let staging = "";
  beforeAll(async () => {
    await new Promise<void>((resolve) => (fake.server as Server).listen(0, "127.0.0.1", resolve));
    const address = fake.server.address();
    endpoint = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    staging = await mkdtemp(join(tmpdir(), "at-s3-"));
  });
  afterAll(async () => {
    fake.server.close();
    await rm(staging, { recursive: true, force: true });
  });

  it("keeps a whole save upload in the bucket and serves it back by range", async () => {
    const store = s3Store(
      { endpoint, bucket: "saves", accessKey: "key", secretKey: "secret", region: "auto" },
      staging,
    );
    await store.check();
    const h = await harness({ storage: { dir: staging, store } });
    try {
      const me = await h.user("utku@example.com");
      const bytes = randomBytes(5 * 1024 * 1024 + 7);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const begun = await h.call(
        "POST",
        "/api/v1/me/saves/uploads",
        { titleId: "CUSA12345", slot: "a", size: bytes.length, sha256 },
        me.token,
      );
      expect(begun.status).toBe(201);
      for (let n = 1; n <= begun.body.parts; n++)
        await h.send("PUT", `/api/v1/me/saves/uploads/${begun.body.uploadId}/parts/${n}`, {
          token: me.token,
          body: bytes.subarray((n - 1) * begun.body.partSize, n * begun.body.partSize),
        });
      const done = await h.call(
        "POST",
        `/api/v1/me/saves/uploads/${begun.body.uploadId}/complete`,
        {},
        me.token,
      );
      expect(done.status).toBe(201);
      expect(fake.objects.get(`${me.id}/${sha256.slice(0, 2)}/${sha256}`)?.bytes.length).toBe(bytes.length);
      const ranged = await h.send("GET", `/api/v1/me/saves/versions/${done.body.version.id}/download`, {
        token: me.token,
        headers: { range: "bytes=10-19" },
      });
      expect(ranged.status).toBe(206);
      expect(Buffer.from(await ranged.arrayBuffer())).toEqual(bytes.subarray(10, 20));
      expect(await store.folders()).toEqual([me.id]);
      expect((await store.list(me.id)).map((o) => o.key)).toEqual([
        `${me.id}/${sha256.slice(0, 2)}/${sha256}`,
      ]);
      await h.call("DELETE", `/api/v1/me/saves/slots/${done.body.save.id}`, undefined, me.token);
      expect(fake.objects.size).toBe(0);
    } finally {
      await h.close();
    }
  });

  it("is refused by the bucket when the bytes are not what their SHA-256 says", async () => {
    const store = s3Store(
      { endpoint, bucket: "saves", accessKey: "key", secretKey: "secret", region: "auto" },
      staging,
    );
    const path = join(staging, "x.bin");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, "hello");
    await expect(
      store.put("a/b/c", path, { size: 5, sha256: "0".repeat(64), contentType: "x" }),
    ).rejects.toThrow(/400/);
    const wrongKey = s3Store(
      { endpoint, bucket: "saves", accessKey: "nope", secretKey: "secret", region: "auto" },
      staging,
    );
    await expect(wrongKey.check()).rejects.toThrow(/403/);
  });
});
