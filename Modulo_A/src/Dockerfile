FROM node:20-alpine

WORKDIR /app

# Copiar definiciones de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Compilar TypeScript
RUN npx tsc --target ES2020 --module commonjs src/main.ts --outDir dist

# Exponer el puerto formal del diagrama
EXPOSE 8080

# Ejecutar la aplicación compilada
CMD ["node", "dist/main.js"]