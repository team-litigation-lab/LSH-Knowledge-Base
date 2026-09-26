import { json, fail, nowIso, oneLine, clean } from './util.js';
import { overLimit, reindex } from './db.js';

// Uploads go to R2 (the FILES binding) in parts, so a long training video
// never has to fit in one request:
//   POST /api/files {action:'start', name, size}        → { id, partSize }
//   PUT  /api/files/<id>/<partNumber>   (raw bytes)       → { etag }
//   POST /api/files {action:'complete', id, parts}       → { file }
//   POST /api/files {action:'abort', id}
//   POST /api/files {action:'text', id, text}            text pulled from a PDF or Office file in the browser, for search
// GET /files/<id>/<name> streams a file back, with Range support so videos can seek.

export const PART_SIZE = 10 * 1024 * 1024;
export const MAX_SIZE = 5 * 1024 * 1024 * 1024;

const KINDS = {
    video: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv'],
    audio: ['mp3', 'm4a', 'wav', 'ogg', 'aac'],
    pdf: ['pdf'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'],
    doc: ['doc', 'docx', 'odt', 'rtf', 'txt', 'md'],
    sheet: ['xls', 'xlsx', 'csv', 'ods'],
    slides: ['ppt', 'pptx', 'odp', 'key'],
    archive: ['zip']
};
const BLOCKED = ['exe', 'bat', 'cmd', 'com', 'msi', 'scr', 'dll', 'sh', 'ps1', 'vbs', 'js', 'mjs', 'jar', 'apk', 'app', 'html', 'htm', 'xhtml', 'svg', 'php', 'hta', 'lnk'];
// Types the browser may show in the page; everything else downloads.
const INLINE = {
    mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
    mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg', aac: 'audio/aac',
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain; charset=utf-8'
};
const DOWNLOAD = {
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', zip: 'application/zip', mkv: 'video/x-matroska', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', heic: 'image/heic', md: 'text/markdown'
};

const ext = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1] || '';
const kindOf = (e) => Object.keys(KINDS).find(k => KINDS[k].includes(e)) || 'other';
const safeName = (name) => oneLine(name, 180).replace(/[\\/:*?"|]/g, '_') || 'file';
const shapeFile = (f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime || '', kind: f.kind, status: f.status });

async function ownFile(ctx, id) {
    const f = await ctx.db.prepare(`SELECT * FROM lib_files WHERE id = ?`).bind(String(id || '')).first();
    if (!f) return { error: fail('That upload no longer exists.', 404) };
    if (f.uploader_key !== ctx.reader.who.key && !ctx.reader.staff) return { error: fail('That upload belongs to someone else.', 403) };
    return { f };
}

export async function startUpload({ request, env, db, reader }, body) {
    if (!env.FILES) return fail('File storage isn’t connected: the R2 bucket (FILES) is not bound to this Worker.', 500);
    if (!reader.staff && await overLimit(request, db, 'upload', 40)) return fail('You’ve started a lot of uploads in a short time. Wait a few minutes and try again.', 429);
    const name = safeName(body.name), e = ext(name), size = Number(body.size) || 0;
    if (!e) return fail('The file needs an extension, like .pdf or .mp4.');
    if (BLOCKED.includes(e)) return fail(`.${e} files can’t be uploaded. Save it as a PDF, or zip it.`);
    if (size <= 0) return fail('That file is empty.');
    if (size > MAX_SIZE) return fail('Files can be up to 5 GB. Compress the video or split it into parts.');
    const id = crypto.randomUUID(), d = new Date();
    const key = `kb/files/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}/${name}`;
    const mime = INLINE[e] || DOWNLOAD[e] || 'application/octet-stream';
    const mpu = await env.FILES.createMultipartUpload(key, { httpMetadata: { contentType: mime }, customMetadata: { uploader: reader.who.name, fileId: id } });
    await db.prepare(`INSERT INTO lib_files (id, r2_key, name, size, mime, kind, status, upload_id, uploader_name, uploader_key, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?)`).bind(id, key, name, size, mime, kindOf(e), mpu.uploadId, reader.who.name, reader.who.key, nowIso()).run();
    return json({ success: true, id, partSize: PART_SIZE, parts: Math.ceil(size / PART_SIZE) });
}

export async function putPart(ctx, id, n) {
    const { f, error } = await ownFile(ctx, id);
    if (error) return error;
    if (f.status !== 'uploading') return fail('This upload is already finished.', 409);
    if (!Number.isInteger(n) || n < 1 || n > 10000) return fail('Bad part number.');
    const bytes = await ctx.request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > PART_SIZE) return fail('Each part must be at most 10 MB.');
    const part = await ctx.env.FILES.resumeMultipartUpload(f.r2_key, f.upload_id).uploadPart(n, bytes);
    return json({ success: true, partNumber: part.partNumber, etag: part.etag });
}

export async function finishUpload(ctx, body) {
    const { f, error } = await ownFile(ctx, body.id);
    if (error) return error;
    if (f.status === 'ready') return json({ success: true, file: shapeFile(f) });
    const parts = (Array.isArray(body.parts) ? body.parts : []).map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
        .sort((a, b) => a.partNumber - b.partNumber);
    if (!parts.length) return fail('No parts were uploaded.');
    const obj = await ctx.env.FILES.resumeMultipartUpload(f.r2_key, f.upload_id).complete(parts);
    await ctx.db.prepare(`UPDATE lib_files SET status = 'ready', size = ?, upload_id = NULL, completed_at = ? WHERE id = ?`).bind(obj.size, nowIso(), f.id).run();
    return json({ success: true, file: shapeFile({ ...f, size: obj.size, status: 'ready' }) });
}

export async function abortUpload(ctx, body) {
    const { f, error } = await ownFile(ctx, body.id);
    if (error) return error;
    if (f.status === 'uploading') {
        try { await ctx.env.FILES.resumeMultipartUpload(f.r2_key, f.upload_id).abort(); } catch (e) { /* already gone */ }
        await ctx.db.prepare(`DELETE FROM lib_files WHERE id = ?`).bind(f.id).run();
    }
    return json({ success: true });
}

export async function saveFileText(ctx, body) {
    const { f, error } = await ownFile(ctx, body.id);
    if (error) return error;
    await ctx.db.prepare(`UPDATE lib_files SET text = ? WHERE id = ?`).bind(clean(body.text, 300000), f.id).run();
    // Entries already showing this file pick up the new text in search.
    const { results } = await ctx.db.prepare(`SELECT entry_id FROM lib_entry_files WHERE file_id = ?`).bind(f.id).all();
    for (const r of results || []) await reindex(ctx.db, r.entry_id);
    return json({ success: true });
}

// Anyone with access can open files that a published entry shows. Files that
// are only in a draft or a suggestion are visible to their uploader and to reviewers.
export async function serveFile({ request, env, db, url, reader }, id) {
    const f = await db.prepare(`SELECT * FROM lib_files WHERE id = ?`).bind(String(id || '')).first();
    if (!f || f.status !== 'ready') return fail('That file isn’t available.', 404);
    if (!reader.staff && f.uploader_key !== reader.who.key) {
        const shown = await db.prepare(`SELECT 1 AS ok FROM lib_entry_files x JOIN lib_entries e ON e.id = x.entry_id WHERE x.file_id = ? AND e.status = 'published' LIMIT 1`).bind(f.id).first();
        if (!shown) {
            // Also allow files in a pending version the reader can see (their own entry's draft).
            const pending = await db.prepare(`SELECT 1 AS ok FROM lib_revisions r JOIN lib_entries e ON e.id = r.entry_id
                WHERE e.author_key = ? AND r.data LIKE ? LIMIT 1`).bind(reader.who.key, `%"id":"${f.id}"%`).first();
            if (!pending) return fail('That file isn’t available.', 404);
        }
    }
    const e = ext(f.name), total = f.size;
    const inlineType = INLINE[e];
    const download = url.searchParams.get('download') === '1' || !inlineType;
    const headers = new Headers({
        'Content-Type': inlineType || DOWNLOAD[e] || 'application/octet-stream',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex'
    });
    let range = null;
    const m = (request.headers.get('Range') || '').match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
        let start, end;
        if (m[1] === '') { start = Math.max(0, total - Number(m[2])); end = total - 1; }
        else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1; }
        if (start >= total || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${total}` } });
        range = { offset: start, length: end - start + 1 };
        headers.set('Content-Range', `bytes ${start}-${end}/${total}`);
    }
    headers.set('Content-Length', String(range ? range.length : total));
    if (request.method === 'HEAD') return new Response(null, { status: range ? 206 : 200, headers });
    const obj = await env.FILES.get(f.r2_key, range ? { range } : undefined);
    if (!obj) return fail('That file is missing from storage.', 404);
    headers.set('ETag', obj.httpEtag);
    return new Response(obj.body, { status: range ? 206 : 200, headers });
}
