import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { getChapter } from "./services/chapter";
import { parseSourceUrl } from "./security/url";
import { safeFetch, readLimited } from "./security/fetch";
const app = new Hono(), maxImageBytes = Number(process.env.MAX_IMAGE_BYTES ?? 15000000);
app.use("/api/*", cors({ origin: (origin) => origin || "*", allowMethods: ["GET", "OPTIONS"] }));
app.get("/api/health", c => c.json({ ok: true, service: "marathon-comic-web" }));
app.get("/api/chapter", async c => { const raw = c.req.query("url"); if (!z.string().url().safeParse(raw).success) return c.json({ error: "Parameter url wajib berupa URL valid." }, 400); try { return c.json(await getChapter(raw)) } catch (e) { return c.json({ error: e instanceof Error ? e.message : "Ekstraksi gagal." }, 422) } });
app.get("/api/next", async c => { try { const chapter = await getChapter(c.req.query("url")); return c.json({ nextChapterUrl: chapter.nextChapterUrl, verified: Boolean(chapter.nextChapterUrl) }) } catch (e) { return c.json({ error: e instanceof Error ? e.message : "Deteksi next gagal." }, 422) } });
app.get("/api/image", async c => { try { const url = parseSourceUrl(c.req.query("url")); const response = await safeFetch(url, { headers: { accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }); if (!response.ok) return c.json({ error: `Sumber gambar HTTP ${response.status}.` }, 502); const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(); if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"].includes(type)) return c.json({ error: "Content-Type gambar tidak diizinkan." }, 415); const body = await readLimited(response, maxImageBytes); return new Response(body as unknown as BodyInit, { headers: { "content-type": type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } }) } catch (e) { return c.json({ error: e instanceof Error ? e.message : "Gagal mengambil gambar." }, 400) } });
app.get("/api/prefetch/events", async c => {
    const raw = c.req.query("url"); try { parseSourceUrl(raw) } catch (e) { return c.json({ error: e instanceof Error ? e.message : "URL tidak valid." }, 400) }
    const stream = new ReadableStream<Uint8Array>({ start(controller) { const enc = new TextEncoder(), send = (event: string, data: unknown) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); void (async () => { try { send("status", { status: "extracting", message: "Mengambil data chapter." }); const chapter = await getChapter(raw); send("chapter", chapter); send("next", { status: chapter.nextChapterUrl ? "found" : "not-found", url: chapter.nextChapterUrl }); send("prefetch", { status: "ready", imageCount: chapter.imageUrls.length }); send("done", { ok: true }) } catch (e) { send("error", { message: e instanceof Error ? e.message : "Ekstraksi gagal." }) } finally { controller.close() } })() } });
    return new Response(stream, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
});
const port = Number(process.env.PORT ?? 8787), host = process.env.HOST ?? "0.0.0.0";
serve({ fetch: app.fetch, port, hostname: host }, info => console.log(`Comic API listening on http://${info.address}:${info.port}`));
