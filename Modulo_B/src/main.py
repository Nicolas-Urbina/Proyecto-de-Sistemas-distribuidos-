from datetime import datetime, timezone
import logging
import os
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError


ESTADOS_VALIDOS = {"pendiente", "asignada", "en_camino", "entregada", "cancelada"}
TRANSICIONES_VALIDAS = {
    "pendiente": {"asignada", "cancelada"},
    "asignada": {"en_camino", "cancelada"},
    "en_camino": {"entregada", "cancelada"},
    "entregada": set(),
    "cancelada": set(),
}


class PayloadTransaccion(BaseModel):
    monto: int
    moneda: str
    cuenta_origen: str
    cuenta_destino: str
    descripcion: str = ""


class RespuestaTransaccion(BaseModel):
    transaccion_id: str
    estado: str
    marca_de_tiempo: str


class PayloadPedido(BaseModel):
    cliente: str = Field(min_length=1)
    direccion: str = Field(min_length=1)
    descripcion: str = Field(min_length=1)


class PayloadAsignacion(BaseModel):
    pedido_id: str = Field(min_length=1)
    repartidor: str = Field(min_length=1)


class PayloadEstado(BaseModel):
    estado: str = Field(min_length=1)


database_url = os.environ["DATABASE_URL"].replace(
    "postgresql://", "postgresql+psycopg2://", 1
)
engine = create_engine(database_url, pool_pre_ping=True)
logger = logging.getLogger(__name__)
app = FastAPI()


@app.exception_handler(RequestValidationError)
async def manejar_error_validacion(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    detalles = [
        {
            "campo": ".".join(str(parte) for parte in error["loc"]),
            "mensaje": error["msg"],
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content={
            "error": "Solicitud inválida",
            "mensaje": "El payload no cumple con el formato requerido.",
            "detalles": detalles,
        },
    )


@app.exception_handler(OperationalError)
async def manejar_error_conexion_bd(
    request: Request, exc: OperationalError
) -> JSONResponse:
    logger.exception("No se pudo completar la operación con la base de datos")
    return JSONResponse(
        status_code=503,
        content={
            "error": "Base de datos no disponible",
            "mensaje": "No se puede procesar la solicitud en este momento.",
        },
        headers={"Retry-After": "5"},
    )


@app.exception_handler(Exception)
async def manejar_error_interno(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Error inesperado al procesar la solicitud")
    return JSONResponse(
        status_code=500,
        content={
            "error": "Error interno del servidor",
            "mensaje": "No se pudo procesar la solicitud.",
        },
    )


def normalizar(valor: str) -> str:
    return valor.strip()


def obtener_pedido(connection, pedido_id: str):
    return connection.execute(
        text(
            """
            SELECT pedido_id, cliente, direccion, descripcion, repartidor,
                   estado, creado_en
            FROM pedidos
            WHERE pedido_id = :pedido_id
            """
        ),
        {"pedido_id": pedido_id},
    ).mappings().one_or_none()


def pedido_json(pedido) -> dict:
    resultado = {
        "pedido_id": str(pedido["pedido_id"]),
        "cliente": pedido["cliente"],
        "direccion": pedido["direccion"],
        "descripcion": pedido["descripcion"],
        "estado": pedido["estado"],
    }
    if pedido["repartidor"] is not None:
        resultado["repartidor"] = pedido["repartidor"]
    return resultado


def registrar_seguimiento(connection, pedido_id: str, estado: str, fecha: datetime):
    connection.execute(
        text(
            """
            INSERT INTO seguimiento (pedido_id, estado, fecha)
            VALUES (:pedido_id, :estado, :fecha)
            """
        ),
        {"pedido_id": pedido_id, "estado": estado, "fecha": fecha},
    )


def crear_pedido(connection, payload: PayloadPedido, pedido_id: str | None = None):
    pedido_id = pedido_id or str(uuid.uuid4())
    fecha = datetime.now(timezone.utc)
    connection.execute(
        text(
            """
            INSERT INTO pedidos (
                pedido_id, cliente, direccion, descripcion, estado, creado_en
            )
            VALUES (
                :pedido_id, :cliente, :direccion, :descripcion, 'pendiente', :creado_en
            )
            """
        ),
        {
            "pedido_id": pedido_id,
            "cliente": normalizar(payload.cliente),
            "direccion": normalizar(payload.direccion),
            "descripcion": normalizar(payload.descripcion),
            "creado_en": fecha,
        },
    )
    registrar_seguimiento(connection, pedido_id, "pendiente", fecha)
    return obtener_pedido(connection, pedido_id)


@app.get("/")
def raiz():
    return {"servicio": "pedidos", "estado": "activo"}


@app.get("/bd/listo")
def verificar_disponibilidad_bd():
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"estado": "listo", "base_de_datos": "disponible"}


@app.post("/pedidos", status_code=201)
def crear_pedido_endpoint(payload: PayloadPedido):
    with engine.begin() as connection:
        pedido = crear_pedido(connection, payload)
        return pedido_json(pedido)


@app.get("/pedidos")
def consultar_pedidos():
    with engine.connect() as connection:
        pedidos = connection.execute(
            text(
                """
                SELECT pedido_id, cliente, direccion, descripcion, repartidor,
                       estado, creado_en
                FROM pedidos
                ORDER BY creado_en DESC
                """
            )
        ).mappings().all()
    return {"pedidos": [pedido_json(pedido) for pedido in pedidos]}


@app.post("/entregas/asignar", status_code=201)
def asignar_repartidor(payload: PayloadAsignacion):
    pedido_id = normalizar(payload.pedido_id)
    repartidor = normalizar(payload.repartidor)
    with engine.begin() as connection:
        pedido = connection.execute(
            text(
                """
                SELECT pedido_id, cliente, direccion, descripcion, repartidor,
                       estado, creado_en
                FROM pedidos
                WHERE pedido_id = :pedido_id
                FOR UPDATE
                """
            ),
            {"pedido_id": pedido_id},
        ).mappings().one_or_none()
        if pedido is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado.")
        if pedido["estado"] != "pendiente":
            raise HTTPException(
                status_code=409,
                detail="Solo se pueden asignar repartidores a pedidos pendientes.",
            )

        fecha = datetime.now(timezone.utc)
        connection.execute(
            text(
                """
                UPDATE pedidos
                SET repartidor = :repartidor, estado = 'asignada'
                WHERE pedido_id = :pedido_id
                """
            ),
            {"pedido_id": pedido_id, "repartidor": repartidor},
        )
        registrar_seguimiento(connection, pedido_id, "asignada", fecha)
        return {
            "pedido_id": pedido_id,
            "repartidor": repartidor,
            "estado": "asignada",
        }


@app.patch("/entregas/{pedido_id}/estado")
def actualizar_estado(pedido_id: str, payload: PayloadEstado):
    pedido_id = normalizar(pedido_id)
    nuevo_estado = normalizar(payload.estado).lower()
    if nuevo_estado not in ESTADOS_VALIDOS:
        raise HTTPException(
            status_code=422,
            detail=f"Estado inválido. Valores permitidos: {', '.join(sorted(ESTADOS_VALIDOS))}.",
        )

    with engine.begin() as connection:
        pedido = connection.execute(
            text(
                "SELECT estado FROM pedidos WHERE pedido_id = :pedido_id FOR UPDATE"
            ),
            {"pedido_id": pedido_id},
        ).mappings().one_or_none()
        if pedido is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado.")
        if nuevo_estado not in TRANSICIONES_VALIDAS[pedido["estado"]]:
            raise HTTPException(
                status_code=409,
                detail=f"No se puede cambiar de '{pedido['estado']}' a '{nuevo_estado}'.",
            )

        fecha = datetime.now(timezone.utc)
        connection.execute(
            text(
                "UPDATE pedidos SET estado = :estado WHERE pedido_id = :pedido_id"
            ),
            {"pedido_id": pedido_id, "estado": nuevo_estado},
        )
        registrar_seguimiento(connection, pedido_id, nuevo_estado, fecha)
        return {"pedido_id": pedido_id, "estado": nuevo_estado}


@app.get("/pedidos/{pedido_id}/seguimiento")
def consultar_seguimiento(pedido_id: str):
    pedido_id = normalizar(pedido_id)
    with engine.connect() as connection:
        pedido = obtener_pedido(connection, pedido_id)
        if pedido is None:
            raise HTTPException(status_code=404, detail="Pedido no encontrado.")
        historial = connection.execute(
            text(
                """
                SELECT estado, fecha
                FROM seguimiento
                WHERE pedido_id = :pedido_id
                ORDER BY fecha ASC, seguimiento_id ASC
                """
            ),
            {"pedido_id": pedido_id},
        ).mappings().all()

    return {
        "pedido_id": pedido_id,
        "estado_actual": pedido["estado"],
        "historial": [
            {"estado": item["estado"], "fecha": item["fecha"].isoformat()}
            for item in historial
        ],
    }


@app.post("/transacciones/", response_model=RespuestaTransaccion)
def procesar_transaccion(payload: PayloadTransaccion) -> RespuestaTransaccion:
    transaccion_id = str(uuid.uuid4())
    marca_de_tiempo = datetime.now(timezone.utc)
    estado = "RECIBIDO"
    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO transacciones (
                    transaccion_id, estado, marca_de_tiempo
                )
                VALUES (
                    CAST(:transaccion_id AS UUID), :estado, :marca_de_tiempo
                )
                """
            ),
            {
                "transaccion_id": transaccion_id,
                "estado": estado,
                "marca_de_tiempo": marca_de_tiempo,
            },
        )

        # A usa este contrato para crear pedidos; se conserva el endpoint
        # para que las transacciones sigan funcionando de forma independiente.
        if payload.monto == 0 and payload.moneda == "N/A":
            pedido_payload = PayloadPedido(
                cliente=payload.cuenta_origen,
                direccion=payload.cuenta_destino,
                descripcion=payload.descripcion,
            )
            crear_pedido(connection, pedido_payload, transaccion_id)

    return RespuestaTransaccion(
        transaccion_id=transaccion_id,
        estado="pendiente" if payload.monto == 0 and payload.moneda == "N/A" else estado,
        marca_de_tiempo=marca_de_tiempo.isoformat(),
    )


@app.delete("/transacciones/{transaccion_id}", status_code=204)
def cancelar_transaccion(transaccion_id: str):
    with engine.begin() as connection:
        resultado = connection.execute(
            text("DELETE FROM transacciones WHERE transaccion_id = CAST(:transaccion_id AS UUID)"),
            {"transaccion_id": transaccion_id},
        )
        connection.execute(
            text("DELETE FROM pedidos WHERE pedido_id = :pedido_id"),
            {"pedido_id": transaccion_id},
        )
    if resultado.rowcount == 0:
        raise HTTPException(status_code=404, detail="Transacción no encontrada.")
