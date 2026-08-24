/// \u003creference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_SERVER_URL?: string;
    readonly VITE_E2E?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
