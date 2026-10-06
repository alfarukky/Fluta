import type { ObjectStorage } from "@/server/integrations/r2";

// In-memory stand-in for R2. Tests never touch a real bucket:
//   vi.mock("@/server/integrations/r2", () => ({ getObjectStorage: () => fakeR2 }))
export class FakeObjectStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Uint8Array; contentType: string }>();
  failPuts = false;
  failDeletes = false;

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    if (this.failPuts) throw new Error("Fake R2: put failed");
    this.objects.set(key, { body, contentType });
  }

  async delete(key: string): Promise<void> {
    if (this.failDeletes) throw new Error("Fake R2: delete failed");
    this.objects.delete(key);
  }

  reset(): void {
    this.objects.clear();
    this.failPuts = false;
    this.failDeletes = false;
  }
}
