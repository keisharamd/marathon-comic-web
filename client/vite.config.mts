import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({root:"client",plugins:[react(),tailwindcss()],server:{host:"0.0.0.0",port:5173,proxy:{"/api":"http://localhost:8787"}},build:{outDir:"../dist-client",emptyOutDir:true}});
