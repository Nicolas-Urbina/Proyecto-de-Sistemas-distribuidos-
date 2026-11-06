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

### Crear un pedido

El gateway también permite registrar un pedido mediante el flujo completo
Módulo A → Módulo B → Módulo C:

```http
POST http://localhost:8080/api/pedidos
Content-Type: application/json
```

Ejemplo de cuerpo:

```json
{
  "cliente": "Juan Pérez",
  "direccion": "Av. Siempre Viva 123",
  "descripcion": "Paquete de documentos"
}
```

El pedido se persiste usando el servicio existente del Módulo B y se registra
en la auditoría del Módulo C con el evento `PEDIDO_CREADO`. La respuesta incluye
el identificador del pedido, su estado y la auditoría asociada.

### Consultar pedidos

```http
GET http://localhost:8080/api/pedidos
```

Módulo A reenvía esta solicitud a `GET /pedidos` del Módulo B y devuelve su
respuesta JSON sin asumir cómo se almacenan los datos. El contrato de respuesta
que debe implementar B es:

```json
{
  "pedidos": [
    {
      "pedido_id": "ped-001",
      "cliente": "Juan Pérez",
      "direccion": "Av. Siempre Viva 123",
      "descripcion": "Paquete de documentos",
      "estado": "pendiente"
    }
  ]
}
```

### Asignar repartidor

```http
POST http://localhost:8080/api/entregas/asignar
Content-Type: application/json
```

Body enviado por el cliente y reenviado sin transformación a B:

```json
{
  "pedido_id": "ped-001",
  "repartidor": "Carlos Gómez"
}
```

Módulo B debe implementar `POST /entregas/asignar` y responder, por ejemplo:

```json
{
  "pedido_id": "ped-001",
  "repartidor": "Carlos Gómez",
  "estado": "asignada"
}
```

Si B responde correctamente, A registra el evento `REPARTIDOR_ASIGNADO` en C
y devuelve la respuesta de B junto con la auditoría. A no guarda datos ni conoce
el esquema de PostgreSQL.

Para cambiar las rutas internas sin modificar A, se pueden configurar
`MODULO_B_PEDIDOS_URL`, `MODULO_B_ASIGNAR_URL`, `MODULO_B_ESTADO_URL` y
`MODULO_B_SEGUIMIENTO_URL`.

### Actualizar estado de entrega

```http
PATCH http://localhost:8080/api/entregas/{pedido_id}/estado
Content-Type: application/json
```

Body:

```json
{
  "estado": "en_camino"
}
```

Módulo A reenvía `PATCH /entregas/{pedido_id}/estado` a B. B debe devolver el
pedido actualizado, por ejemplo:

```json
{
  "pedido_id": "ped-001",
  "estado": "en_camino"
}
```

Luego A registra en C el evento `ESTADO_ENTREGA_ACTUALIZADO` y devuelve la
respuesta de B junto con la auditoría. Los estados sugeridos son `pendiente`,
`asignada`, `en_camino`, `entregada` y `cancelada`; B es responsable de
validar las transiciones.

### Consultar seguimiento

```http
GET http://localhost:8080/api/entregas/{pedido_id}
```

A reenvía la solicitud a `GET /pedidos/{pedido_id}/seguimiento` de B y devuelve
su respuesta JSON sin conocer cómo se almacena el historial. B puede responder:

```json
{
  "pedido_id": "ped-001",
  "estado_actual": "en_camino",
  "historial": [
    {
      "estado": "pendiente",
      "fecha": "2026-11-01T15:00:00Z"
    },
    {
      "estado": "en_camino",
      "fecha": "2026-11-01T15:10:00Z"
    }
  ]
}
```

### Transacciones

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

## Verificación de persistencia y salud

El gateway expone endpoints para comprobar las bases sin conectarse directamente
desde Postman a los contenedores internos:

```http
GET http://localhost:8080/api/salud
```

Devuelve `200` solamente cuando PostgreSQL y MongoDB responden. Si alguna base
no está disponible devuelve `503`, indicando cuál dependencia falló.

Para comprobar los datos guardados:

```http
GET http://localhost:8080/api/pedidos
GET http://localhost:8080/api/auditoria
GET http://localhost:8080/api/entregas/{pedido_id}
```

`/api/pedidos` consulta PostgreSQL, `/api/auditoria` consulta la colección
`auditoria_db.historial_transacciones` de MongoDB y `/api/entregas/{pedido_id}`
consulta el historial del pedido en PostgreSQL. Ninguno devuelve datos de
memoria si la base correspondiente está caída.

Para eliminar una transacción/pedido y sus auditorías asociadas:

```http
DELETE http://localhost:8080/api/transacciones/{transaccion_id}
```

El gateway coordina `DELETE /transacciones/{transaccion_id}` en B y
`DELETE /auditoria?transaccion_id={transaccion_id}` en C. B elimina de
PostgreSQL y C elimina todos los registros de auditoría de MongoDB que tengan
ese identificador. Si la eliminación en C falla después de eliminar B, la
respuesta será `503` y avisará que puede haber datos pendientes de limpieza.
Los endpoints internos también pueden probarse dentro de la red:

```http
DELETE http://modulo-b:5000/transacciones/{transaccion_id}
DELETE http://modulo-c:6001/auditoria?transaccion_id={transaccion_id}
```

Cuando se crea una transacción o pedido, A primero solicita el registro a B y
después registra la auditoría en C. Si C falla, A solicita una compensación a B
mediante `DELETE /transacciones/{transaccion_id}`; la respuesta informa si esa
reversión pudo completarse. Esto implementa una transacción compensatoria
(patrón Saga), no una transacción ACID distribuida. Por eso se debe revisar
`/api/salud` y los logs si la respuesta indica que la compensación falló.

## Docker: conceptos importantes

### Servicios, DNS y redes

Compose crea una red virtual para los servicios. Dentro de esa red, los nombres
de servicio funcionan como DNS: por ejemplo, `modulo-b` resuelve al contenedor
de B y `db-nosql` al de MongoDB. No se debe usar `localhost` entre contenedores,
porque allí significa “este mismo contenedor”. Docker puede cambiar la IP de un
contenedor al recrearlo, pero vuelve a resolver el nombre del servicio, por lo
que los demás servicios no necesitan conocer esa IP.

Este proyecto usa dos redes:

- `distributed-network`: comunicación de A, C y MongoDB.
- `db-relacional-net`: comunicación privada entre B y PostgreSQL.

Los puertos `expose` son internos. Solo A (`8080`) y MongoDB (`27017`) están
publicados en el host actualmente. `depends_on` ordena el arranque y los
`healthcheck` verifican disponibilidad; no reemplaza el manejo de errores de la
aplicación.

### Comunicación y sockets

Los servicios se comunican mediante HTTP sobre TCP usando los nombres DNS y
puertos internos (`modulo-b:5000`, `modulo-c:6001`). El “socket” es el extremo
de esa conexión TCP; no se está usando el `docker.sock` del host. Montar
`/var/run/docker.sock` no es necesario para este proyecto y daría permisos muy
amplios al contenedor.

Los volúmenes `pg-data` y `mongo-data` mantienen los datos aunque se recreen
los contenedores. `docker compose down -v` elimina también esos volúmenes y,
por tanto, los datos.

## Visualizar las bases de datos

### PostgreSQL con pgAdmin

PostgreSQL no publica un puerto al host, así que hay dos alternativas:

1. Ejecutar pgAdmin como otro contenedor conectado a `db-relacional-net`; usar
   como servidor `db-relacional`, puerto `5432`, base `${DB_NAME}`, usuario
   `${DB_USER}` y contraseña `${DB_PASSWORD}`.
2. Para usar un pgAdmin instalado en el host, publicar temporalmente
   `5432:5432` en `db-relacional` y conectarse a `localhost:5432`. No se
   recomienda dejar ese puerto público en un entorno real.

Una vez conectado, las tablas principales son `transacciones`, `pedidos` y
`seguimiento`.

### MongoDB

MongoDB publica `27017`, por lo que se puede usar MongoDB Compass u otra
interfaz compatible desde el host con:

```text
mongodb://localhost:27017
```

Selecciona la base `auditoria_db` y la colección
`historial_transacciones`. También se puede consultar desde el contenedor con
`mongosh`; no es obligatorio instalar un administrador adicional para que el
sistema funcione, pero Compass es la opción gráfica equivalente a pgAdmin.




endpoint para le get para solicitar datos del mongo db
