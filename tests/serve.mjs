import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = Number.parseInt(process.env.AIT_TEST_PORT ?? '8765', 10);
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
};

createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const filePath = normalize(join(root, pathname));
        const relativePath = relative(root, filePath);

        if (relativePath.startsWith('..') || relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
            response.writeHead(403).end('Forbidden');
            return;
        }

        const fileStat = await stat(filePath);
        if (!fileStat.isFile()) {
            response.writeHead(404).end('Not found');
            return;
        }

        response.writeHead(200, {
            'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        createReadStream(filePath).pipe(response);
    } catch {
        response.writeHead(404).end('Not found');
    }
}).listen(port, '127.0.0.1', () => {
    console.log(`Test server: http://127.0.0.1:${port}/SillyTavern-AdditionalInfoTooltip/tests/browser-harness.html`);
});
