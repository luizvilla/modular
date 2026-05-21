if (typeof globalThis.File === 'undefined') {
    globalThis.File = class File {};
}

if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class Blob {};
}
