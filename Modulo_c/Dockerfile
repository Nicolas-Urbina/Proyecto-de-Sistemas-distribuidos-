# Etapa 1: Compilación
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Copiar definiciones de dependencias
COPY go.mod go.sum* ./
RUN go mod download || true

# Copiar el código fuente
COPY . .

# Compilar binario estático
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /app/server ./src/main.go

# Etapa 2: Contenedor ligero de ejecución
FROM alpine:latest

RUN apk --no-cache add ca-certificates

WORKDIR /root/
COPY --from=builder /app/server .

# Puerto interno establecido en la arquitectura
EXPOSE 6000

ENV PORT=6000
ENV MONGO_URI=mongodb://db-nosql:27017
ENV MONGO_DB=auditoria_db

CMD ["./server"]
