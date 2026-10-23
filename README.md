# Proyecto de Sistemas Distribuidos

## Levantar el sistema

El archivo [`docker-compose.yml`](./docker-compose.yml) se encuentra en la raíz
del repositorio porque coordina todos los servicios del proyecto:

- **Módulo A**: gateway HTTP, expuesto en `http://localhost:8080`.
- **Módulo B**: servicio de transacciones, disponible únicamente dentro de la
  red de Docker en el puerto `5000`.
- **Módulo C**: servicio de auditoría, disponible únicamente dentro de la red
  de Docker en el puerto `6001`.
- **MongoDB**: base de datos de auditoría con el volumen persistente
  `mongo-data`.

Desde la raíz del repositorio:

```bash
cp .env.example .env
docker compose up --build
```

El archivo `.env` es necesario para configurar PostgreSQL. No lo subas al
repositorio: puede contener credenciales reales.

Para comprobar el estado de los servicios:

```bash
docker compose ps
docker compose logs -f modulo-a modulo-b modulo-c
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

Envía el cuerpo como JSON (en Postman, selecciona **Body → raw → JSON**). Si
falta el cuerpo o no es un objeto JSON, el gateway responde con `400`.

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

## Flujo de una transacción

El cliente solo debe llamar al **Módulo A**, que funciona como puerta de
enlace:

1. Módulo A valida el JSON y envía la transacción a Módulo B.
2. Módulo B registra el estado y la fecha en PostgreSQL.
3. Módulo A envía el evento al Módulo C.
4. Módulo C registra la auditoría en MongoDB.
5. Módulo A devuelve al cliente la respuesta combinada.

Por eso Módulos B y C no necesitan estar publicados en `localhost`; son
accesibles entre sí mediante la red interna de Docker. MongoDB sí publica el
puerto `27017` para facilitar inspecciones locales, pero tampoco es necesario
para probar el flujo desde Postman.

### Prueba rápida con Postman

Configura:

- Método: `POST`
- URL: `http://localhost:8080/api/transacciones`
- Header: `Content-Type: application/json`
- Body → raw → JSON:

```json
{
  "monto": 100,
  "moneda": "ARS",
  "cuenta_origen": "001",
  "cuenta_destino": "002",
  "descripcion": "Transferencia de prueba"
}
```

Una operación correcta devuelve `201` e incluye `transaccion` y `auditoria`.
También puedes comprobar dependencias directamente desde el gateway:

```bash
curl -i http://localhost:8080/api/transacciones
```

Ese `GET` normalmente devolverá `404`, pero confirma que el gateway está
respondiendo. Para una prueba real usa el `POST` anterior.
