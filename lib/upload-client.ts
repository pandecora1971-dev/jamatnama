// Browser side of evidence upload. File bytes go straight to R2 and never pass through the app.
export type UploadPlan =
  | { id: string; mode: "put"; url: string; headers: Record<string, string> }
  | { id: string; mode: "multipart"; partSize: number; partCount: number };

class HttpFailure extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}
function put(url: string, body: Blob, headers: Record<string, string>, onProgress: (sent: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new HttpFailure(xhr.status)));
    xhr.onerror = () => reject(new HttpFailure(0));
    xhr.ontimeout = () => reject(new HttpFailure(0));
    xhr.send(body);
  });
}
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryable = (error: unknown) => {
  const status = error instanceof HttpFailure ? error.status : 0;
  return status === 0 || status === 408 || status === 429 || status >= 500;
};
async function postJson(url: string, body: unknown) {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (error) {
      if (attempt >= 4) throw error;
      await pause(1000 * 2 ** attempt);
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    if (attempt < 4 && (response.status === 429 || response.status >= 500)) {
      await pause(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(data.error || "জমা দেওয়া যায়নি।");
  }
}
async function uploadPut(plan: Extract<UploadPlan, { mode: "put" }>, file: File, report: (sent: number) => void) {
  for (let attempt = 0; ; attempt++) {
    try {
      await put(plan.url, file, plan.headers, report);
      return;
    } catch (error) {
      // 412: an earlier attempt reached storage although its response was lost. Finalize verifies it.
      if (error instanceof HttpFailure && error.status === 412) return;
      if (attempt >= 4 || !retryable(error)) throw new Error("ফাইল আপলোড করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
      await pause(1000 * 2 ** attempt);
    }
  }
}
async function uploadMultipart(token: string, plan: Extract<UploadPlan, { mode: "multipart" }>, file: File, report: (sent: number) => void) {
  const sent = new Map<number, number>();
  const update = () => report([...sent.values()].reduce((sum, n) => sum + n, 0));
  const urls = new Map<number, string>();
  let next = 1;
  const sign = async (from: number) => {
    const partNumbers = [];
    for (let n = from; n <= plan.partCount && partNumbers.length < 8; n++) partNumbers.push(n);
    const { parts } = await postJson("/api/uploads/sign", { token, fileId: plan.id, partNumbers });
    for (const part of parts) urls.set(part.partNumber, part.url);
  };
  const worker = async () => {
    while (next <= plan.partCount) {
      const n = next++;
      const body = file.slice((n - 1) * plan.partSize, n * plan.partSize);
      for (let attempt = 0; ; attempt++) {
        try {
          if (!urls.has(n)) await sign(n);
          await put(urls.get(n)!, body, {}, (bytes) => {
            sent.set(n, bytes);
            update();
          });
          sent.set(n, body.size);
          update();
          urls.delete(n);
          break;
        } catch (error) {
          urls.delete(n);
          // 403 usually means the signature expired during a slow upload, so sign again.
          const expired = error instanceof HttpFailure && error.status === 403;
          if (attempt >= 5 || (!retryable(error) && !expired)) throw new Error("ফাইল আপলোড করা যায়নি। সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।");
          sent.set(n, 0);
          await pause(1000 * 2 ** attempt);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, plan.partCount) }, worker));
  await postJson("/api/uploads/complete", { token, fileId: plan.id });
}
/** Uploads every file, then returns the ids to attach. Progress is reported as 0..1 across all files. */
export async function uploadEvidence(token: string, plans: UploadPlan[], files: File[], onProgress: (fraction: number) => void) {
  const total = files.reduce((sum, file) => sum + file.size, 0) || 1;
  const done = files.map(() => 0);
  const report = (index: number) => (sent: number) => {
    done[index] = sent;
    onProgress(Math.min(1, done.reduce((sum, n) => sum + n, 0) / total));
  };
  // One large file at a time keeps a phone connection usable.
  for (const [index, plan] of plans.entries()) {
    if (plan.mode === "put") await uploadPut(plan, files[index], report(index));
    else await uploadMultipart(token, plan, files[index], report(index));
  }
  return plans.map((plan) => plan.id);
}
export { postJson };
