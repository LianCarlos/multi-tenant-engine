import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Necesario para que Next.js no intente empaquetar el módulo nativo
  // de better-sqlite3 cuando se importa el cliente DB desde server code.
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
