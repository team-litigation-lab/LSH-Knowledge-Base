// Uploads a file to the library in 10 MB parts (three at a time, each retried
// up to three times), then pulls the text out of PDFs and Office files so
// search can find what's inside them.
(function () {
    async function call(path, opts) {
        const res = await fetch(path, { credentials: 'same-origin', ...opts });
        let data = {};
        try { data = await res.json(); } catch (e) { /* not JSON */ }
        if (!res.ok || data.success === false) throw new Error(data.error || `Upload failed (${res.status}).`);
        return data;
    }
    const post = (body) => call('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

    async function upload(file, { onProgress = () => {}, signal } = {}) {
        const start = await post({ action: 'start', name: file.name, size: file.size });
        const { id, partSize } = start;
        const total = Math.ceil(file.size / partSize);
        const done = new Array(total).fill(0);
        const parts = [];
        let next = 0;
        const report = () => onProgress(Math.min(1, done.reduce((a, b) => a + b, 0) / file.size));
        async function worker() {
            while (next < total) {
                const i = next++;
                const blob = file.slice(i * partSize, Math.min(file.size, (i + 1) * partSize));
                for (let attempt = 1; ; attempt++) {
                    if (signal && signal.aborted) throw new Error('Upload cancelled.');
                    try {
                        const r = await call(`/api/files/${id}/${i + 1}`, { method: 'PUT', body: blob, signal });
                        parts.push({ partNumber: r.partNumber, etag: r.etag });
                        done[i] = blob.size; report();
                        break;
                    } catch (e) {
                        if (attempt >= 3 || (signal && signal.aborted)) throw e;
                        await new Promise(r => setTimeout(r, 1500 * attempt));
                    }
                }
            }
        }
        try {
            await Promise.all([worker(), worker(), worker()]);
            const fin = await post({ action: 'complete', id, parts });
            extractText(file).then(text => { if (text && text.trim()) post({ action: 'text', id, text }).catch(() => {}); }).catch(() => {});
            return fin.file;
        } catch (e) {
            post({ action: 'abort', id }).catch(() => {});
            throw e;
        }
    }

    /* ---------- text for search ---------- */
    const loaded = {};
    function load(src) {
        return loaded[src] || (loaded[src] = new Promise((ok, bad) => {
            const s = document.createElement('script');
            s.src = src; s.onload = ok; s.onerror = () => bad(new Error('Could not load ' + src));
            document.head.appendChild(s);
        }));
    }
    const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';
    const xmlText = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map(m => m[1]).join(' ');

    async function extractText(file) {
        const e = (file.name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
        if (file.size > 60 * 1024 * 1024) return null;
        if (e === 'txt' || e === 'md' || e === 'csv') return (await file.text()).slice(0, 300000);
        if (e === 'pdf') {
            await load(CDN + 'pdf.js/3.11.174/pdf.min.js');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = CDN + 'pdf.js/3.11.174/pdf.worker.min.js';
            const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
            const out = [];
            for (let p = 1; p <= Math.min(pdf.numPages, 400); p++) {
                const tc = await (await pdf.getPage(p)).getTextContent();
                out.push(tc.items.map(i => i.str).join(' '));
            }
            return out.join('\n').slice(0, 300000);
        }
        if (e === 'docx') {
            await load(CDN + 'mammoth/1.6.0/mammoth.browser.min.js');
            return (await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value.slice(0, 300000);
        }
        if (e === 'pptx' || e === 'xlsx') {
            await load(CDN + 'jszip/3.10.1/jszip.min.js');
            const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
            const names = Object.keys(zip.files).filter(n => e === 'pptx' ? /^ppt\/slides\/slide\d+\.xml$/.test(n) : n === 'xl/sharedStrings.xml');
            const texts = [];
            for (const n of names) texts.push(xmlText(await zip.file(n).async('string'), e === 'pptx' ? 'a:t' : 't'));
            return texts.join('\n').slice(0, 300000);
        }
        return null;
    }

    window.KBUpload = { upload, extractText };
})();
