# Proyecto de Sistemas Distribuidos

## Levantar el sistema

El archivo [`docker-compose.yml`](./docker-compose.yml) se encuentra en la raíz
del repositorio porque coordina todos los servicios del proyecto:

- **Módulo A**: gateway HTTP, expuesto en `http://localhost:8080`.
- **Módulo B**: servicio de transacciones, disponible únicamente dentro de la
  red de Docker en el puerto `5000`.
- **Módulo C**: servicio de auditoría, disponible únicamente dentro de la red
  de Docker en el puerto `6000`.
- **MongoDB**: base de datos de auditoría con el volumen persistente
  `mongo-data`.

Desde la raíz del repositorio:

```bash
docker compose up --build
```

Para detener los servicios:

```bash
docker compose down
```

Para detenerlos y eliminar también los datos persistidos de MongoDB:

```bash
docker compose down -v
```

## Endpoint principal

El gateway recibe transacciones mediante:

```http
POST http://localhost:8080/api/transacciones
Content-Type: application/json
```

Ejemplo de cuerpo:

```json
{
  "monto": 100,
  "moneda": "ARS",
  "cuenta_origen": "001",
  "cuenta_destino": "002",
  "descripcion": "Transferencia de prueba"
}
```
