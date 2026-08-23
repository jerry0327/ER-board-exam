// Vercel/Nitro compatibility shim for Cloudflare's workerd-only virtual module.
// The production ChatGPT Sites/Cloudflare build never imports this file.
// Cloudflare-bound persistence features intentionally see no bindings on Vercel
// and fall back through their existing error/local-only paths.
export const env: Record<string, any> = Object.freeze({});
