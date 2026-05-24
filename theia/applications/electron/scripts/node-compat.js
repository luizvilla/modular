// Node 18 build-time shim: File and Blob became global in Node 21.
// Remove this file once the build environment is on Node 20+.
if (typeof globalThis.File === 'undefined') {
    globalThis.File = class File {};
}
if (typeof globalThis.Blob === 'undefined') {
    globalThis.Blob = class Blob {};
}
