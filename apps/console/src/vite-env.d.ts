/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the VMS API, baked at build time (see Dockerfile / docker-compose). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
