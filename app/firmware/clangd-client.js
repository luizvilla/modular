const { spawn } = require('child_process');
const path = require('path');
const { pathToFileURL } = require('url');

function toDocumentUri(inputPath) {
    return pathToFileURL(path.resolve(inputPath)).toString();
}

class ClangdClient {
    constructor(options = {}) {
        this.command = options.command;
        this.args = Array.isArray(options.args) ? options.args.slice() : [];
        this.cwd = options.cwd || process.cwd();
        this.env = options.env || process.env;
        this.rootUri = options.rootUri || null;
        this.workspaceName = options.workspaceName || 'firmware-workspace';
        this.onDiagnostics = typeof options.onDiagnostics === 'function' ? options.onDiagnostics : () => {};
        this.onOutput = typeof options.onOutput === 'function' ? options.onOutput : () => {};
        this.onExit = typeof options.onExit === 'function' ? options.onExit : () => {};
        this.process = null;
        this.pending = new Map();
        this.documents = new Map();
        this.nextRequestId = 1;
        this.stdoutBuffer = Buffer.alloc(0);
        this.initialized = false;
        this.startPromise = null;
    }

    async start() {
        if (this.startPromise) return this.startPromise;
        this.startPromise = this.#start();
        return this.startPromise;
    }

    async #start() {
        if (this.process) return this;
        this.process = spawn(this.command, this.args, {
            cwd: this.cwd,
            env: this.env,
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
        });

        this.process.stdout?.on('data', (chunk) => {
            this.#handleStdout(chunk);
        });
        this.process.stderr?.on('data', (chunk) => {
            const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
            if (text) this.onOutput(text, 'stderr');
        });
        this.process.on('error', (err) => {
            this.#rejectPending(err);
        });
        this.process.on('close', (code, signal) => {
            this.#rejectPending(new Error(`clangd exited with ${code}${signal ? ` via ${signal}` : ''}`));
            this.process = null;
            this.initialized = false;
            this.documents.clear();
            this.onExit({ code, signal });
        });

        const capabilities = await this.request('initialize', {
            processId: process.pid,
            clientInfo: {
                name: 'modular-firmware-workspace',
                version: 'session-7',
            },
            rootUri: this.rootUri,
            workspaceFolders: this.rootUri ? [{
                uri: this.rootUri,
                name: this.workspaceName,
            }] : [],
            capabilities: {
                textDocument: {
                    publishDiagnostics: {
                        relatedInformation: false,
                        versionSupport: true,
                    },
                    completion: {
                        completionItem: {
                            documentationFormat: ['markdown', 'plaintext'],
                            snippetSupport: false,
                        },
                    },
                    hover: {
                        contentFormat: ['markdown', 'plaintext'],
                    },
                    definition: {
                        linkSupport: true,
                    },
                },
            },
        });

        this.initialized = true;
        this.serverCapabilities = capabilities?.capabilities || {};
        this.notify('initialized', {});
        return this;
    }

    dispose() {
        try {
            if (this.process && !this.process.killed) {
                this.process.kill('SIGTERM');
            }
        } catch {}
        this.process = null;
        this.initialized = false;
        this.documents.clear();
        this.#rejectPending(new Error('clangd client disposed'));
    }

    async ensureDocument({ filePath, text, languageId = 'cpp' }) {
        await this.start();
        const uri = toDocumentUri(filePath);
        const nextText = String(text ?? '');
        const entry = this.documents.get(uri);
        if (!entry) {
            const version = 1;
            this.documents.set(uri, { version, text: nextText, filePath });
            this.notify('textDocument/didOpen', {
                textDocument: {
                    uri,
                    languageId,
                    version,
                    text: nextText,
                },
            });
            return { uri, version };
        }
        if (entry.text !== nextText) {
            const version = entry.version + 1;
            entry.version = version;
            entry.text = nextText;
            this.notify('textDocument/didChange', {
                textDocument: {
                    uri,
                    version,
                },
                contentChanges: [{ text: nextText }],
            });
            return { uri, version };
        }
        return { uri, version: entry.version };
    }

    async completion({ filePath, text, position, languageId = 'cpp' }) {
        const document = await this.ensureDocument({ filePath, text, languageId });
        return this.request('textDocument/completion', {
            textDocument: { uri: document.uri },
            position,
        });
    }

    async hover({ filePath, text, position, languageId = 'cpp' }) {
        const document = await this.ensureDocument({ filePath, text, languageId });
        return this.request('textDocument/hover', {
            textDocument: { uri: document.uri },
            position,
        });
    }

    async definition({ filePath, text, position, languageId = 'cpp' }) {
        const document = await this.ensureDocument({ filePath, text, languageId });
        return this.request('textDocument/definition', {
            textDocument: { uri: document.uri },
            position,
        });
    }

    notify(method, params) {
        this.#send({ jsonrpc: '2.0', method, params });
    }

    request(method, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextRequestId;
            this.nextRequestId += 1;
            this.pending.set(id, { resolve, reject, method });
            this.#send({ jsonrpc: '2.0', id, method, params });
        });
    }

    #send(message) {
        if (!this.process?.stdin) {
            throw new Error('clangd process is not running.');
        }
        const payload = Buffer.from(JSON.stringify(message), 'utf8');
        const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, 'utf8');
        this.process.stdin.write(Buffer.concat([header, payload]));
    }

    #handleStdout(chunk) {
        const nextChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk || ''), 'utf8');
        this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, nextChunk]);

        while (this.stdoutBuffer.length > 0) {
            const separatorIndex = this.stdoutBuffer.indexOf('\r\n\r\n');
            if (separatorIndex === -1) return;
            const header = this.stdoutBuffer.slice(0, separatorIndex).toString('utf8');
            const match = header.match(/Content-Length:\s*(\d+)/i);
            if (!match) {
                throw new Error('clangd response did not include Content-Length.');
            }
            const contentLength = Number.parseInt(match[1], 10);
            const bodyStart = separatorIndex + 4;
            const bodyEnd = bodyStart + contentLength;
            if (this.stdoutBuffer.length < bodyEnd) return;
            const body = this.stdoutBuffer.slice(bodyStart, bodyEnd).toString('utf8');
            this.stdoutBuffer = this.stdoutBuffer.slice(bodyEnd);
            if (!body.trim()) continue;
            const message = JSON.parse(body);
            this.#handleMessage(message);
        }
    }

    #handleMessage(message) {
        if (Object.prototype.hasOwnProperty.call(message, 'id')) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) {
                pending.reject(new Error(message.error.message || 'clangd request failed.'));
                return;
            }
            pending.resolve(message.result);
            return;
        }

        if (message.method === 'textDocument/publishDiagnostics') {
            const params = message.params || {};
            this.onDiagnostics(params);
            return;
        }

        if (message.method === 'window/logMessage') {
            const params = message.params || {};
            if (params.message) this.onOutput(`${params.message}\n`, 'stdout');
        }
    }

    #rejectPending(error) {
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}

module.exports = {
    ClangdClient,
    toDocumentUri,
};
