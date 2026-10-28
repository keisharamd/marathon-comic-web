import { assertPublicDestination, parseSourceUrl } from "./url";

const timeoutMs = Number(process.env.FETCH_TIMEOUT_MS ?? 12000);
const maxRedirects = Number(process.env.MAX_REDIRECTS ?? 4);
const responseTimers = new WeakMap<Response, ReturnType<typeof setTimeout>>();

export async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = parseSourceUrl(String(input));
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    await assertPublicDestination(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        redirect: "manual",
        signal: init.signal ?? controller.signal,
        headers: { "user-agent": "MarathonComicReader/1.0", accept: "*/*", ...init.headers },
      });
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      const location = response.headers.get("location");
      if (!location) return response;
      if (redirects === maxRedirects) throw new Error("Batas redirect sumber terlampaui.");
      url = parseSourceUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.body) clearTimeout(timer);
    else responseTimers.set(response, timer);
    return response;
  }
  throw new Error("Gagal mengikuti redirect.");
}

export async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const timer = responseTimers.get(response);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > maxBytes) {
    if (timer) clearTimeout(timer);
    throw new Error("Respons sumber terlalu besar.");
  }
  if (!response.body) {
    if (timer) clearTimeout(timer);
    throw new Error("Respons sumber kosong.");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Respons sumber melebihi batas ukuran.");
      }
      chunks.push(value);
    }
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
