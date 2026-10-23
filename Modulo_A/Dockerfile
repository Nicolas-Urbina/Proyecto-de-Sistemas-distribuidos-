# -------------------------------------------------------------
# Etapa 1: Build (Compilación de TypeScript)
# -------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar todas las dependencias (incluyendo TypeScript y tipos)
RUN npm install

# Copiar el código fuente y compilar
COPY . .
RUN npx tsc --target ES2020 --module commonjs --esModuleInterop src/main.ts --outDir dist

# -------------------------------------------------------------
# Etapa 2: Runner (Imagen final de producción ultra liviana)
# -------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Variables de entorno de producción
ENV NODE_ENV=production

# Copiar únicamente package.json para instalar solo dependencias de ejecución
COPY package*.json ./

# Instalar solo dependencias de producción (omite @types/*, tsc, etc.) y limpia caché
RUN npm install --omit=dev && npm cache clean --force

# Copiar únicamente el JavaScript compilado desde la etapa anterior
COPY --from=builder /app/dist ./dist

# Exponer el puerto formal del proyecto
EXPOSE 8080

# Correr el archivo JavaScript final
CMD ["node", "dist/main.js"]