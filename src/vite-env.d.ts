/// <reference types="vite/client" />
declare module 'virtual:dbify-asset/*' {
  const asset: { url?: string; inline?: string };
  export default asset;
}
declare module 'sql.js' {
  const initSqlJs: (config?: { wasmBinary?: ArrayBuffer | Uint8Array }) => Promise<any>;
  export default initSqlJs;
}
