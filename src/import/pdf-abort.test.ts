import { describe, expect, it, vi } from "vitest";
import {
  abortable,
  isImportAbort,
  linkedAbort,
  throwIfAborted,
} from "./pdf-abort";

describe("local import cancellation", () => {
  it("stops in-flight work and consumes its eventual rejection", async () => {
    const controller = new AbortController();
    let rejectWork!: (reason: unknown) => void;
    const work = new Promise<string>((_, reject) => {
      rejectWork = reject;
    });
    const cancel = vi.fn();
    const result = abortable(work, controller.signal, cancel);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    rejectWork(new Error("Cancelled renderer rejected later"));
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("removes listeners after successful work and propagates original errors", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(
      abortable(Promise.resolve(12), controller.signal),
    ).resolves.toBe(12);
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    const failure = new Error("Local PDF unavailable");
    await expect(
      abortable(Promise.reject(failure), controller.signal),
    ).rejects.toBe(failure);
  });

  it("cancels work that began before receiving an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancel = vi.fn();
    await expect(
      abortable(Promise.reject(new Error("Late")), controller.signal, cancel),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(() => throwIfAborted(controller.signal)).toThrow("Import cancelled");
    expect(isImportAbort(new DOMException("Cancelled", "AbortError"))).toBe(
      true,
    );
    expect(isImportAbort(new Error("Malformed PDF"))).toBe(false);
  });

  it("allows either operation or session lifetime to abort, releasing both listeners", () => {
    const operation = new AbortController();
    const lifetime = new AbortController();
    const a = vi.spyOn(operation.signal, "removeEventListener");
    const b = vi.spyOn(lifetime.signal, "removeEventListener");
    const linked = linkedAbort(operation.signal, lifetime.signal);
    lifetime.abort();
    expect(linked.signal.aborted).toBe(true);
    linked.release();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });
});
