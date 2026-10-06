import "server-only";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

import { getServerEnv } from "@/lib/env";

// Cloudflare R2 through its S3 API. The only module that talks to R2; tests
// replace it with the fake in src/test/fake-r2.ts.
export interface ObjectStorage {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
}

let storage: ObjectStorage | undefined;

// Created on first use so `next build` needs no R2 secrets.
export function getObjectStorage(): ObjectStorage {
  storage ??= createR2Storage();
  return storage;
}

function createR2Storage(): ObjectStorage {
  const env = getServerEnv();
  const client = new S3Client({
    region: "auto", // required by the SDK, ignored by R2
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: env.R2_BUCKET,
          Key: key,
          Body: body,
          // Set by Fluta from the file's bytes, never from the upload request.
          ContentType: contentType,
          // Keys are unique per upload, so the file never changes.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
    },
  };
}
