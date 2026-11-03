/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["@duckdb/node-api", "@duckdb/node-bindings"],
};

export default nextConfig;
